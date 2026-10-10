"""Evaluate indexed image retrieval against independently reviewed image labels.

This module uses only the Python standard library. It never runs inference or
uses detections as ground truth. See docs/evaluation.md for the label format.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class EvaluationError(ValueError):
    """Input or collection state cannot produce a trustworthy evaluation."""


@dataclass(frozen=True)
class ImageLabels:
    filename: str
    categories: frozenset[str]
    file_hash: str | None = None


def canonical_category(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EvaluationError("Each category must be a nonempty string.")
    return value.strip().lower()


def load_labels(path: Path) -> dict[str, ImageLabels]:
    """Require explicit labels for every image, including reviewed negatives."""
    try:
        document = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EvaluationError(f"Cannot read labels: {exc}") from exc
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise EvaluationError("Labels must be an object with schema_version 1.")
    rows = document.get("images")
    if not isinstance(rows, list) or not rows:
        raise EvaluationError("Labels must contain a nonempty images array.")
    labels: dict[str, ImageLabels] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise EvaluationError("Each images entry must be an object.")
        filename = row.get("filename")
        if not isinstance(filename, str) or not filename.strip():
            raise EvaluationError("Each label requires a nonempty filename.")
        if filename in labels:
            raise EvaluationError(f"Duplicate filename in labels: {filename}")
        categories = row.get("categories")
        if not isinstance(categories, list):
            raise EvaluationError(f"Review {filename}: categories must be an array; null means unreviewed.")
        canonical = [canonical_category(category) for category in categories]
        if len(canonical) != len(set(canonical)):
            raise EvaluationError(f"Duplicate categories in labels for {filename}.")
        file_hash = row.get("file_hash")
        if file_hash is not None:
            if (
                not isinstance(file_hash, str)
                or len(file_hash) != 64
                or any(char not in "0123456789abcdefABCDEF" for char in file_hash)
            ):
                raise EvaluationError(f"Invalid SHA-256 file_hash for {filename}.")
            file_hash = file_hash.lower()
        labels[filename] = ImageLabels(filename, frozenset(canonical), file_hash)
    return labels


class ApiClient:
    def __init__(self, api_url: str, timeout: float = 30.0):
        self.api_url = api_url.rstrip("/")
        if not self.api_url.startswith(("http://", "https://")):
            raise EvaluationError("--api-url must start with http:// or https://.")
        self.timeout = timeout

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            f"{self.api_url}{path}",
            data=body,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            method=method,
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                result = json.load(response)
        except HTTPError as exc:
            raise EvaluationError(f"API returned HTTP {exc.code} for {path}.") from exc
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise EvaluationError(f"Cannot read API response for {path}: {exc}") from exc
        if not isinstance(result, dict):
            raise EvaluationError(f"API returned an invalid JSON object for {path}.")
        return result

    def collection(self) -> list[dict[str, Any]]:
        return collect_pages(
            lambda page, page_size: self.request("GET", f"/api/images?page={page}&page_size={page_size}")
        )

    def search(self, categories: list[str], mode: str, confidence: float) -> list[dict[str, Any]]:
        return collect_pages(
            lambda page, page_size: self.request(
                "POST",
                "/api/search",
                {
                    "categories": categories,
                    "mode": mode,
                    "confidence": confidence,
                    "sort": "confidence_desc",
                    "page": page,
                    "page_size": page_size,
                },
            )
        )


def collect_pages(fetch: Callable[[int, int], dict[str, Any]], page_size: int = 100) -> list[dict[str, Any]]:
    """Read every result page and reject incomplete or unstable responses."""
    collected: list[dict[str, Any]] = []
    identities: set[str] = set()
    expected_total: int | None = None
    page = 1
    while True:
        response = fetch(page, page_size)
        rows, total = response.get("items"), response.get("total")
        if not isinstance(rows, list) or isinstance(total, bool) or not isinstance(total, int) or total < 0:
            raise EvaluationError("API pagination must return items and a nonnegative total.")
        if expected_total is not None and total != expected_total:
            raise EvaluationError("Collection changed during pagination; rerun when idle.")
        expected_total = total
        for row in rows:
            if not isinstance(row, dict) or not row.get("id"):
                raise EvaluationError("Each API image must have an id.")
            identity = str(row["id"])
            if identity in identities:
                raise EvaluationError("API returned duplicate image IDs during pagination.")
            identities.add(identity)
            collected.append(row)
        if len(collected) > total:
            raise EvaluationError("API returned more images than its declared total.")
        if len(collected) == total:
            return collected
        if not rows:
            raise EvaluationError("API pagination ended before all images were returned.")
        page += 1


def collection_by_filename(images: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    collection: dict[str, dict[str, Any]] = {}
    for image in images:
        filename = image.get("filename")
        if not isinstance(filename, str) or not filename.strip():
            raise EvaluationError("Every indexed image must have a filename.")
        if filename in collection:
            raise EvaluationError(
                f"Ambiguous duplicate indexed filename: {filename}. "
                "Rename the source files uniquely and rebuild the evaluation collection."
            )
        if image.get("status") != "completed":
            raise EvaluationError(
                f"Image {filename} is {image.get('status', 'unknown')}; "
                "all images must finish indexing successfully before evaluation."
            )
        collection[filename] = image
    return collection


def validate_collection(
    labels: dict[str, ImageLabels], images: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    collection = collection_by_filename(images)
    missing_labels = sorted(collection.keys() - labels.keys())
    missing_images = sorted(labels.keys() - collection.keys())
    if missing_labels or missing_images:
        raise EvaluationError(
            "Labels must describe exactly the full indexed collection. "
            f"Unlabeled indexed images: {missing_labels}. "
            f"Labeled images absent from index: {missing_images}."
        )
    for filename, label in labels.items():
        if label.file_hash and label.file_hash != collection[filename].get("file_hash"):
            raise EvaluationError(f"File hash mismatch for {filename}; the image changed.")
    return collection


def relevant_filenames(labels: dict[str, ImageLabels], categories: Iterable[str], mode: str) -> set[str]:
    query = frozenset(canonical_category(category) for category in categories)
    if not query:
        raise EvaluationError("Select at least one category for evaluation.")
    if mode not in {"and", "or"}:
        raise EvaluationError("Search mode must be and or or.")
    return {
        filename
        for filename, label in labels.items()
        if (query <= label.categories if mode == "and" else bool(query & label.categories))
    }


def calculate_metrics(relevant: set[str], retrieved: set[str]) -> dict[str, Any]:
    """Undefined precision/recall are null, not artificially perfect scores."""
    true_positive = sorted(relevant & retrieved)
    false_positive = sorted(retrieved - relevant)
    false_negative = sorted(relevant - retrieved)
    tp, fp, fn = len(true_positive), len(false_positive), len(false_negative)
    return {
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None,
        "correctly_retrieved": true_positive,
        "incorrectly_retrieved": false_positive,
        "missed_relevant": false_negative,
    }


def collection_signature(collection: dict[str, dict[str, Any]]) -> list[tuple[Any, ...]]:
    return sorted(
        (
            filename,
            str(image.get("id")),
            image.get("file_hash"),
            image.get("status"),
            image.get("model"),
        )
        for filename, image in collection.items()
    )


def evaluate(
    client: ApiClient,
    labels: dict[str, ImageLabels],
    categories: list[str],
    mode: str,
    confidence: float,
) -> dict[str, Any]:
    if not math.isfinite(confidence) or not 0 <= confidence <= 1:
        raise EvaluationError("Confidence must be a finite number between 0 and 1.")
    query = sorted({canonical_category(category) for category in categories})
    relevant = relevant_filenames(labels, query, mode)
    collection = validate_collection(labels, client.collection())
    rows = client.search(query, mode, confidence)
    retrieved: set[str] = set()
    for row in rows:
        filename = row.get("filename")
        if filename not in collection or str(row.get("id")) != str(collection[filename]["id"]):
            raise EvaluationError("Search returned an image outside the labeled collection.")
        if filename in retrieved:
            raise EvaluationError("Search returned the same image more than once.")
        retrieved.add(filename)
    after = validate_collection(labels, client.collection())
    if collection_signature(collection) != collection_signature(after):
        raise EvaluationError("Collection changed during evaluation; rerun when idle.")
    return {
        "schema_version": 1,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "api_url": client.api_url,
        "query": {"categories": query, "mode": mode, "confidence": confidence},
        "collection_size": len(collection),
        "relevant_count": len(relevant),
        "retrieved_count": len(retrieved),
        "models": sorted({str(image.get("model", "unknown")) for image in collection.values()}),
        "hash_verified_images": sum(label.file_hash is not None for label in labels.values()),
        "metrics": calculate_metrics(relevant, retrieved),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, required=True, help="Reviewed ground-truth JSON.")
    parser.add_argument(
        "--categories",
        nargs="+",
        action="append",
        required=True,
        help='COCO names; quote names with spaces, for example "traffic light". Repeatable.',
    )
    parser.add_argument("--mode", choices=("and", "or"), default="and")
    parser.add_argument("--confidence", type=float, default=0.5)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, help="Also save the complete report as JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        labels = load_labels(arguments.labels)
        categories = [category for group in arguments.categories for category in group]
        report = evaluate(
            ApiClient(arguments.api_url), labels, categories, arguments.mode, arguments.confidence
        )
        rendered = json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        if arguments.output:
            arguments.output.parent.mkdir(parents=True, exist_ok=True)
            arguments.output.write_text(rendered, encoding="utf-8")
        print(rendered, end="")
        return 0
    except (EvaluationError, OSError) as exc:
        print(f"Evaluation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

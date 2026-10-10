"""Export an unreviewed manual-label template from the indexed collection.

This tool does not download images, create simulated evaluation data, or infer
ground truth from YOLO predictions. Fill every null categories value by hand.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from scripts.evaluate import ApiClient, EvaluationError, collection_by_filename
except ModuleNotFoundError:
    from evaluate import ApiClient, EvaluationError, collection_by_filename


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, default=Path("data/evaluation/labels.json"))
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise EvaluationError(
                f"Output already exists: {args.output}. Choose a new path to preserve manual labels."
            )
        collection = collection_by_filename(ApiClient(args.api_url).collection())
        if not collection:
            raise EvaluationError("Upload and index demo images before exporting labels.")
        rows = []
        for filename, image in sorted(collection.items()):
            row = {"filename": filename, "categories": None}
            if image.get("file_hash"):
                row["file_hash"] = image["file_hash"]
            rows.append(row)
        document = {
            "schema_version": 1,
            "description": "Manually review every image; replace null with its visible COCO categories.",
            "images": rows,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents accidental replacement by a concurrent export.
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(document, destination, indent=2, ensure_ascii=False)
            destination.write("\n")
        print(f"Exported {len(rows)} unreviewed images to {args.output}.")
        print("Inspect each original image and replace every categories: null before evaluation.")
        return 0
    except (EvaluationError, OSError) as exc:
        print(f"Template export failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Retrieval evaluation must measure manual relevance, not model agreement."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Support both repository-root and backend-directory pytest invocations.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.evaluate import (  # noqa: E402
    EvaluationError,
    ImageLabels,
    calculate_metrics,
    collect_pages,
    evaluate,
    load_labels,
    relevant_filenames,
    validate_collection,
)


def image(identity: str, filename: str, status: str = "completed") -> dict:
    return {
        "id": identity,
        "filename": filename,
        "status": status,
        "file_hash": "a" * 64,
        "model": "yolo11m.pt",
    }


@pytest.fixture
def labels() -> dict[str, ImageLabels]:
    return {
        "cycling.jpg": ImageLabels("cycling.jpg", frozenset({"person", "bicycle"}), "a" * 64),
        "walking.jpg": ImageLabels("walking.jpg", frozenset({"person"}), "a" * 64),
        "empty.jpg": ImageLabels("empty.jpg", frozenset(), "a" * 64),
    }


def test_precision_recall_and_filename_evidence():
    result = calculate_metrics({"correct.jpg", "missed.jpg"}, {"correct.jpg", "wrong.jpg"})
    assert result["true_positives"] == 1
    assert result["false_positives"] == 1
    assert result["false_negatives"] == 1
    assert result["precision"] == result["recall"] == result["f1"] == 0.5
    assert result["correctly_retrieved"] == ["correct.jpg"]
    assert result["incorrectly_retrieved"] == ["wrong.jpg"]
    assert result["missed_relevant"] == ["missed.jpg"]


@pytest.mark.parametrize(
    ("relevant", "retrieved", "precision", "recall", "f1"),
    [
        (set(), set(), None, None, None),
        ({"a"}, set(), None, 0.0, 0.0),
        (set(), {"a"}, 0.0, None, 0.0),
        ({"a"}, {"a"}, 1.0, 1.0, 1.0),
    ],
)
def test_zero_denominators_are_explicit(relevant, retrieved, precision, recall, f1):
    result = calculate_metrics(relevant, retrieved)
    assert result["precision"] == precision
    assert result["recall"] == recall
    assert result["f1"] == f1


def test_and_or_relevance_uses_manual_categories(labels):
    assert relevant_filenames(labels, [" Person ", "BICYCLE"], "and") == {"cycling.jpg"}
    assert relevant_filenames(labels, ["person", "bicycle"], "or") == {
        "cycling.jpg", "walking.jpg"
    }
    with pytest.raises(EvaluationError, match="at least one category"):
        relevant_filenames(labels, [], "and")


def test_label_loader_rejects_unreviewed_template(tmp_path):
    path = tmp_path / "labels.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "images": [{"filename": "photo.jpg", "categories": None}],
    }))
    with pytest.raises(EvaluationError, match="null means unreviewed"):
        load_labels(path)


def test_label_loader_accepts_reviewed_negative_and_normalizes(tmp_path):
    path = tmp_path / "labels.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "images": [
            {"filename": "photo.jpg", "categories": [" Person ", "TRAFFIC LIGHT"], "file_hash": "A" * 64},
            {"filename": "empty.jpg", "categories": []},
        ],
    }))
    result = load_labels(path)
    assert result["photo.jpg"].categories == {"person", "traffic light"}
    assert result["photo.jpg"].file_hash == "a" * 64
    assert result["empty.jpg"].categories == frozenset()


def test_label_loader_rejects_duplicate_filenames(tmp_path):
    path = tmp_path / "labels.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "images": [{"filename": "same.jpg", "categories": []}] * 2,
    }))
    with pytest.raises(EvaluationError, match="Duplicate filename"):
        load_labels(path)


def test_complete_collection_required(labels):
    with pytest.raises(EvaluationError, match="full indexed collection"):
        validate_collection(labels, [image("1", "cycling.jpg")])


@pytest.mark.parametrize("status", ["queued", "processing", "failed"])
def test_incomplete_or_failed_indexing_is_not_a_retrieval_miss(labels, status):
    with pytest.raises(EvaluationError, match="finish indexing successfully"):
        validate_collection(labels, [image("1", "cycling.jpg", status)])


def test_ambiguous_original_filenames_rejected(labels):
    with pytest.raises(EvaluationError, match="Ambiguous duplicate indexed filename"):
        validate_collection(labels, [image("1", "cycling.jpg"), image("2", "cycling.jpg")])


def test_hash_prevents_reusing_labels_for_different_image():
    labels = {"photo.jpg": ImageLabels("photo.jpg", frozenset({"person"}), "b" * 64)}
    with pytest.raises(EvaluationError, match="hash mismatch"):
        validate_collection(labels, [image("1", "photo.jpg")])


def test_pagination_reads_all_pages_without_truncating_results():
    calls = []

    def fetch(page, page_size):
        calls.append((page, page_size))
        return {"items": [image(str(page), f"{page}.jpg")], "total": 3}

    assert len(collect_pages(fetch, page_size=1)) == 3
    assert calls == [(1, 1), (2, 1), (3, 1)]


def test_pagination_rejects_unstable_total():
    def fetch(page, page_size):
        return {"items": [image(str(page), f"{page}.jpg")], "total": page + 1}

    with pytest.raises(EvaluationError, match="changed during pagination"):
        collect_pages(fetch)


def test_pagination_rejects_duplicate_results():
    with pytest.raises(EvaluationError, match="duplicate image IDs"):
        collect_pages(lambda *_: {"items": [image("1", "same.jpg")], "total": 2})


def test_pagination_rejects_incomplete_results():
    with pytest.raises(EvaluationError, match="ended before all"):
        collect_pages(lambda *_: {"items": [], "total": 1})


class FakeClient:
    api_url = "http://test.invalid"

    def __init__(self):
        self.images = [image("1", "cycling.jpg"), image("2", "walking.jpg"), image("3", "empty.jpg")]
        self.calls = []

    def collection(self):
        return self.images

    def search(self, categories, mode, confidence):
        self.calls.append((categories, mode, confidence))
        # Deliberately omit one relevant image and return one irrelevant image.
        return [self.images[0], self.images[2]]


def test_end_to_end_evaluation_uses_retrieval_results_and_reports_errors(labels):
    client = FakeClient()
    report = evaluate(client, labels, ["Person"], "and", 0.6)
    assert client.calls == [(["person"], "and", 0.6)]
    assert report["collection_size"] == 3
    assert report["relevant_count"] == 2
    assert report["retrieved_count"] == 2
    assert report["hash_verified_images"] == 3
    assert report["models"] == ["yolo11m.pt"]
    assert report["metrics"]["precision"] == 0.5
    assert report["metrics"]["missed_relevant"] == ["walking.jpg"]


@pytest.mark.parametrize("confidence", [-0.1, 1.1, float("nan"), float("inf")])
def test_invalid_threshold_is_rejected_before_network_work(labels, confidence):
    with pytest.raises(EvaluationError, match="finite number"):
        evaluate(FakeClient(), labels, ["person"], "and", confidence)


def test_collection_change_during_search_invalidates_evaluation(labels):
    class ChangedClient(FakeClient):
        def search(self, categories, mode, confidence):
            results = [dict(self.images[0])]
            self.images = [dict(row, id=f"new-{row['id']}") for row in self.images]
            return results

    with pytest.raises(EvaluationError, match="changed during evaluation"):
        evaluate(ChangedClient(), labels, ["person"], "and", 0.5)


def test_unknown_retrieved_image_invalidates_evaluation(labels):
    class OutsideClient(FakeClient):
        def search(self, categories, mode, confidence):
            return [image("other", "outside.jpg")]

    with pytest.raises(EvaluationError, match="outside the labeled collection"):
        evaluate(OutsideClient(), labels, ["person"], "and", 0.5)

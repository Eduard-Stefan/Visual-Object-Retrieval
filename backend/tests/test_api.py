"""Real SQLite and file storage API tests with inexpensive deterministic inference."""

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import threading
import time

from fastapi.testclient import TestClient
from PIL import Image as PillowImage
import pytest
from sqlalchemy import func, select

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.models import DetectionRecord


def detection(class_id, class_name, confidence, **coordinates):
    return (
        dict(class_id=class_id, class_name=class_name, confidence=confidence, x1=2, y1=3, x2=24, y2=25)
        | coordinates
    )


class FakeDetector:
    model_name = "test-yolo11m"

    def __init__(self):
        self.calls = 0
        self.fail_next = False
        self.started = threading.Event()
        self.release: threading.Event | None = None
        self.predictions = None

    def status(self):
        return dict(
            model=self.model_name,
            device="cpu",
            half=False,
            ready=True,
            error=None,
            hardware={"cuda_available": False},
            warnings=[],
        )

    def predict(self, path: Path):
        self.calls += 1
        self.started.set()
        if self.release:
            assert self.release.wait(timeout=5), "Test inference was not released."
        if self.fail_next:
            self.fail_next = False
            raise RuntimeError("Synthetic inference failure")
        if self.predictions is not None:
            return self.predictions
        with PillowImage.open(path) as image:
            red, green, blue = image.getpixel((0, 0))
        if red > 200 and green < 40 and blue < 40:
            return [detection(0, "person", 0.90), detection(1, "bicycle", 0.70), detection(2, "car", 0.45)]
        if green > 200 and red < 40:
            return [detection(2, "car", 0.95), detection(0, "person", 0.55)]
        if blue > 200 and red < 40:
            return [detection(16, "dog", 0.85)]
        return []


def image_bytes(color="red", size=(40, 32), format="PNG"):
    payload = BytesIO()
    PillowImage.new("RGB", size, color).save(payload, format=format)
    return payload.getvalue()


def wait_for_job(client, job_id):
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200, response.text
        job = response.json()
        if job["status"] in {"completed", "failed"}:
            return job
        time.sleep(0.01)
    pytest.fail("The indexing job did not finish within six seconds.")


def upload(client, images):
    response = client.post(
        "/api/images/upload",
        files=[("files", (filename, image_bytes(color), "image/png")) for filename, color in images],
    )
    assert response.status_code == 202, response.text
    return wait_for_job(client, response.json()["job_id"])


@pytest.fixture
def configured(tmp_path):
    return Settings(data_dir=tmp_path / "data", frontend_dist=tmp_path / "dist")


@pytest.fixture
def app_client(configured):
    detector = FakeDetector()
    app = create_app(configured, detector)
    with TestClient(app) as client:
        yield client, app, detector


def test_health_system_and_empty_collection(app_client):
    client, _, detector = app_client
    assert client.get("/api/health").json() == {"status": "ok"}
    system = client.get("/api/system").json()
    assert system["model"] == detector.model_name
    assert system["detection_confidence"] == 0.15
    assert client.get("/api/images").json()["total"] == 0
    assert client.get("/api/search/categories").json() == []
    assert client.post("/api/search", json={"categories": ["car"]}).json()["items"] == []
    assert client.get("/api/statistics").json() == dict(
        total_images=0, total_objects=0, total_categories=0, distribution=[]
    )


def test_valid_upload_persists_metadata_images_and_thumbnail(app_client):
    client, app, detector = app_client
    job = upload(client, [("city.png", "red")])
    assert (job["status"], job["uploaded"], job["processed"], job["failed"]) == ("completed", 1, 1, 0)
    image = client.get("/api/images?confidence=0.15").json()["items"][0]
    assert image["filename"] == "city.png"
    assert (image["width"], image["height"]) == (40, 32)
    assert image["model"] == detector.model_name
    assert image["status"] == "completed"
    assert image["uploaded_at"].endswith("Z")
    assert len(image["file_hash"]) == 64
    assert image["object_count"] == 3
    assert image["detections"][0]["x1"] == 2
    assert client.get(image["file_url"]).headers["content-type"] == "image/jpeg"
    assert client.get(image["thumbnail_url"]).status_code == 200
    assert client.get(f"/api/images/{image['id']}?confidence=.8").json()["object_count"] == 1
    assert len(client.get(f"/api/images/{image['id']}/detections?confidence=.8").json()) == 1
    with app.state.database.session() as session:
        assert session.scalar(select(func.count()).select_from(DetectionRecord)) == 3


@pytest.mark.parametrize(
    "filename,payload",
    [
        ("malware.exe", image_bytes()),
        ("broken.png", b"this is not an image"),
        ("empty.jpg", b""),
    ],
)
def test_invalid_upload_is_rejected_without_stored_files(app_client, filename, payload):
    client, app, detector = app_client
    response = client.post("/api/images/upload", files=[("files", (filename, payload, "image/png"))])
    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert client.get("/api/images").json()["total"] == 0
    assert not list(app.state.settings.images_dir.iterdir())
    assert detector.calls == 0


def test_upload_size_dimensions_and_batch_limits(configured):
    settings = configured.model_copy(
        update={"max_upload_files": 2, "max_file_mb": 1, "max_image_pixels": 100}
    )
    with TestClient(create_app(settings, FakeDetector())) as client:
        response = client.post(
            "/api/images/upload", files=[("files", ("large.png", b"x" * (1024 * 1024 + 1), "image/png"))]
        )
        assert response.status_code == 400
        assert "1 MB" in response.json()["detail"]
        response = client.post(
            "/api/images/upload", files=[("files", ("huge.png", image_bytes(), "image/png"))]
        )
        assert response.status_code == 400
        assert "100 pixel" in response.json()["detail"]
        response = client.post(
            "/api/images/upload", files=[("files", ("x.png", image_bytes(size=(5, 5)), "image/png"))] * 3
        )
        assert response.status_code == 413


def test_upload_body_limit_checks_declared_and_streamed_sizes(configured):
    settings = configured.model_copy(update={"max_upload_body_mb": 1})
    with TestClient(create_app(settings, FakeDetector())) as client:
        response = client.post(
            "/api/images/upload", files=[("files", ("large.png", b"x" * (1024 * 1024), "image/png"))]
        )
        assert response.status_code == 413
        assert "1 MB request limit" in response.json()["detail"]
        chunks = [
            b'--test\r\nContent-Disposition: form-data; name="files"; filename="large.png"\r\nContent-Type: image/png\r\n\r\n',
            b"x" * (512 * 1024),
            b"x" * (512 * 1024),
            b"\r\n--test--\r\n",
        ]
        response = client.post(
            "/api/images/upload",
            content=iter(chunks),
            headers={"Content-Type": "multipart/form-data; boundary=test"},
        )
        assert response.status_code == 413
        assert "1 MB request limit" in response.json()["detail"]
        assert client.get("/api/images").json()["total"] == 0


def test_duplicate_file_is_indexed_once_even_with_different_filename(app_client):
    client, _, detector = app_client
    job = upload(client, [("first.png", "red"), ("same.png", "red")])
    assert (job["uploaded"], job["duplicates"], job["processed"]) == (1, 1, 2)
    repeat = upload(client, [("again.png", "red")])
    assert repeat["duplicates"] == 1
    assert client.get("/api/images").json()["total"] == 1
    assert detector.calls == 1


def test_concurrent_duplicate_uploads(app_client):
    client, _, detector = app_client

    def submit(index):
        response = client.post(
            "/api/images/upload", files=[("files", (f"same-{index}.png", image_bytes(), "image/png"))]
        )
        assert response.status_code == 202, response.text
        return response.json()["job_id"]

    with ThreadPoolExecutor(max_workers=4) as executor:
        jobs = list(executor.map(submit, range(4)))
    results = [wait_for_job(client, job) for job in jobs]
    assert sum(job["uploaded"] for job in results) == 1
    assert sum(job["duplicates"] for job in results) == 3
    assert client.get("/api/images").json()["total"] == 1
    assert detector.calls == 1


def test_mixed_valid_invalid_upload_reports_partial_failure(app_client):
    client, _, _ = app_client
    response = client.post(
        "/api/images/upload",
        files=[
            ("files", ("valid.png", image_bytes(), "image/png")),
            ("files", ("invalid.png", b"bad", "image/png")),
        ],
    )
    assert response.status_code == 202
    job = wait_for_job(client, response.json()["job_id"])
    assert (job["uploaded"], job["failed"], job["processed"]) == (1, 1, 2)
    assert "invalid.png" in job["errors"][0]


def test_single_multi_object_and_or_and_unknown_search(app_client):
    client, _, detector = app_client
    upload(client, [("bicycle.png", "red"), ("car.png", "lime"), ("dog.png", "blue")])
    calls = detector.calls

    def search(categories, mode="and", confidence=0.5):
        return client.post(
            "/api/search", json=dict(categories=categories, mode=mode, confidence=confidence)
        ).json()

    assert search(["car"])["items"][0]["filename"] == "car.png"
    both = search([" Person ", "Bicycle"])
    assert both["total"] == 1 and both["items"][0]["matching_count"] == 2
    assert search(["person", "bicycle"], confidence=0.7)["total"] == 1
    assert search(["person", "dog"])["total"] == 0
    assert search(["person", "dog"], "or")["total"] == 3
    assert search(["person", "unknown"])["total"] == 0
    assert search(["dog", "unknown"], "or")["total"] == 1
    assert search([])["total"] == 3
    assert detector.calls == calls


def test_confidence_filters_categories_annotations_statistics_and_retrieval(app_client):
    client, _, detector = app_client
    upload(client, [("bicycle.png", "red"), ("car.png", "lime")])
    assert {
        category["class_name"] for category in client.get("/api/search/categories?confidence=.8").json()
    } == {"person", "car"}
    assert (
        client.post("/api/search", json={"categories": ["person", "car"], "confidence": 0.5}).json()["total"]
        == 1
    )
    assert (
        client.post("/api/search", json={"categories": ["person", "car"], "confidence": 0.8}).json()["total"]
        == 0
    )
    stats = client.get("/api/statistics?confidence=.8").json()
    assert (stats["total_images"], stats["total_objects"], stats["total_categories"]) == (2, 2, 2)
    assert all(
        detection["confidence"] >= 0.8
        for item in client.get("/api/images?confidence=.8").json()["items"]
        for detection in item["detections"]
    )
    assert detector.calls == 2


def test_confidence_ranking_filename_time_sort_and_pagination(app_client):
    client, _, _ = app_client
    upload(client, [("zebra.png", "red")])
    upload(client, [("Alpha.png", "lime")])

    def names(sort, categories=None):
        return [
            item["filename"]
            for item in client.post("/api/search", json=dict(categories=categories or [], sort=sort)).json()[
                "items"
            ]
        ]

    assert names("confidence_desc") == ["Alpha.png", "zebra.png"]
    assert names("confidence_asc") == ["zebra.png", "Alpha.png"]
    assert names("confidence_desc", ["person"]) == ["zebra.png", "Alpha.png"]
    assert names("confidence_asc", ["person"]) == ["Alpha.png", "zebra.png"]
    assert names("filename") == ["Alpha.png", "zebra.png"]
    assert names("newest") == ["Alpha.png", "zebra.png"]
    assert names("oldest") == ["zebra.png", "Alpha.png"]
    page = client.get("/api/images?page=2&page_size=1&sort=filename").json()
    assert (page["total"], page["page"], page["page_size"]) == (2, 2, 1)
    assert page["items"][0]["filename"] == "zebra.png"


def test_delete_image_cascades_detections_and_files_then_clear(app_client):
    client, app, _ = app_client
    upload(client, [("bicycle.png", "red"), ("car.png", "lime")])
    image = client.get("/api/images").json()["items"][0]
    assert client.delete(f"/api/images/{image['id']}").status_code == 204
    assert client.get(image["file_url"]).status_code == 404
    assert client.get("/api/images").json()["total"] == 1
    assert len(list(app.state.settings.images_dir.iterdir())) == 1
    assert client.delete("/api/images").status_code == 204
    assert client.get("/api/images").json()["total"] == 0
    assert not list(app.state.settings.images_dir.iterdir())
    assert not list(app.state.settings.thumbnails_dir.iterdir())
    with app.state.database.session() as session:
        assert session.scalar(select(func.count()).select_from(DetectionRecord)) == 0


@pytest.mark.parametrize(
    "safe_error", [None, "Could not download YOLO weights. Check the internet connection and retry."]
)
def test_failed_inference_is_visible_and_can_be_retried(app_client, monkeypatch, safe_error):
    client, _, detector = app_client
    original_status = detector.status
    monkeypatch.setattr(detector, "status", lambda: original_status() | {"error": safe_error})
    detector.fail_next = True
    job = upload(client, [("retry.png", "red")])
    assert job["status"] == "failed" and job["failed"] == 1
    image = client.get("/api/images").json()["items"][0]
    assert image["status"] == "failed" and image["error"]
    if safe_error:
        assert image["error"] == safe_error
        assert safe_error in job["errors"][0]
    monkeypatch.setattr(detector, "status", original_status)
    response = client.post(f"/api/images/{image['id']}/retry")
    assert response.status_code == 202
    assert wait_for_job(client, response.json()["job_id"])["uploaded"] == 1
    assert client.get(f"/api/images/{image['id']}").json()["status"] == "completed"
    assert client.post(f"/api/images/{image['id']}/retry").status_code == 409


@pytest.mark.parametrize("clear", [False, True])
def test_delete_during_inference_does_not_resurrect_image(app_client, clear):
    client, _, detector = app_client
    detector.release = threading.Event()
    try:
        response = client.post(
            "/api/images/upload", files=[("files", ("active.png", image_bytes(), "image/png"))]
        )
        assert detector.started.wait(timeout=3)
        image = client.get("/api/images").json()["items"][0]
        path = "/api/images" if clear else f"/api/images/{image['id']}"
        assert client.delete(path).status_code == 204
    finally:
        detector.release.set()
    job = wait_for_job(client, response.json()["job_id"])
    assert job["processed"] == job["total"] == 1
    time.sleep(0.03)
    assert client.get("/api/images").json()["total"] == 0
    assert client.get("/api/statistics").json()["total_objects"] == 0


def test_pending_queue_is_bounded(configured):
    detector = FakeDetector()
    detector.release = threading.Event()
    try:
        with TestClient(
            create_app(configured.model_copy(update={"max_pending_images": 1}), detector)
        ) as client:
            first = client.post(
                "/api/images/upload", files=[("files", ("first.png", image_bytes(), "image/png"))]
            )
            assert first.status_code == 202
            second = client.post(
                "/api/images/upload", files=[("files", ("second.png", image_bytes("blue"), "image/png"))]
            )
            assert second.status_code == 429
            detector.release.set()
            wait_for_job(client, first.json()["job_id"])
    finally:
        detector.release.set()


def test_persistence_and_recovery_of_queued_jobs(configured):
    detector = FakeDetector()
    with TestClient(create_app(configured, detector)) as client:
        upload(client, [("persisted.png", "red")])
        client.app.state.indexer.stop()
        response = client.post(
            "/api/images/upload", files=[("files", ("pending.png", image_bytes("blue"), "image/png"))]
        )
        pending_id = response.json()["job_id"]
    with TestClient(create_app(configured, FakeDetector())) as restarted:
        assert wait_for_job(restarted, pending_id)["uploaded"] == 1
        assert restarted.get("/api/images").json()["total"] == 2
        assert restarted.post("/api/search", json={"categories": ["person"]}).json()["total"] == 1


def test_filename_safety_exif_orientation_and_detection_clipping(app_client):
    client, _, detector = app_client
    detector.predictions = [
        detection(0, "Person", 0.9, x1=-50, y1=-10, x2=500, y2=500),
        detection(1, "bicycle", float("nan")),
        detection(2, "car", 0.1),
    ]
    image = PillowImage.new("RGB", (20, 40), "red")
    exif = PillowImage.Exif()
    exif[274] = 6
    buffer = BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    response = client.post(
        "/api/images/upload", files=[("files", ("../../unsafe.jpg", buffer.getvalue(), "image/jpeg"))]
    )
    assert response.status_code == 202
    wait_for_job(client, response.json()["job_id"])
    item = client.get("/api/images").json()["items"][0]
    assert item["filename"] == "unsafe.jpg"
    assert (item["width"], item["height"]) == (40, 20)
    assert item["object_count"] == 1
    assert item["detections"][0]["class_name"] == "person"
    assert tuple(item["detections"][0][key] for key in ("x1", "y1", "x2", "y2")) == (0, 0, 40, 20)


def test_request_errors_are_readable_and_unknown_ids_are_not_found(app_client):
    client, _, _ = app_client
    for path in ("/api/images?confidence=2", "/api/images?page=0", "/api/images?page_size=101"):
        response = client.get(path)
        assert response.status_code == 422
        assert isinstance(response.json()["detail"], str)
    assert client.post("/api/search", json={"mode": "xor"}).status_code == 422
    assert client.get("/api/images/missing").status_code == 404
    assert client.get("/api/jobs/missing").status_code == 404
    assert client.delete("/api/images/missing").status_code == 404
    assert client.get("/api/unknown").status_code == 404


def test_production_frontend_is_served_without_masking_api_errors(configured):
    configured.frontend_dist.mkdir()
    (configured.frontend_dist / "index.html").write_text(
        "<html>Visual Object Retrieval</html>", encoding="utf-8"
    )
    with TestClient(create_app(configured, FakeDetector())) as client:
        assert "Visual Object Retrieval" in client.get("/").text
        assert client.get("/collection").status_code == 200
        assert client.get("/api/unknown").status_code == 404

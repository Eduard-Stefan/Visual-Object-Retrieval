"""Opt-in real image indexing and retrieval, including a database restart."""

import importlib.util
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import REPOSITORY_ROOT, Settings
from backend.app.main import create_app


@pytest.mark.inference
@pytest.mark.skipif(os.environ.get("VOR_RUN_INFERENCE_TEST") != "1", reason="Real inference is opt in")
def test_real_photographs_are_indexed_searched_and_persisted(tmp_path):
    specification = importlib.util.find_spec("ultralytics")
    if specification is None:
        pytest.skip("Install Ultralytics to run the real pipeline smoke test")
    assets = Path(specification.origin).parent / "assets"
    if not all((assets / filename).is_file() for filename in ("bus.jpg", "zidane.jpg")):
        pytest.skip("The installed Ultralytics distribution has no smoke photographs")
    # Reuse trusted downloaded weights while keeping all test image data isolated.
    model = REPOSITORY_ROOT / "data" / "models" / "yolo11m.pt"
    configuration = Settings(data_dir=tmp_path, model=str(model) if model.is_file() else "yolo11m.pt")
    with TestClient(create_app(configuration)) as client:
        response = client.post(
            "/api/images/upload",
            files=[
                ("files", (filename, (assets / filename).read_bytes(), "image/jpeg"))
                for filename in ("bus.jpg", "zidane.jpg")
            ],
        )
        assert response.status_code == 202
        job_id = response.json()["job_id"]
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["status"] in {"completed", "failed"}:
                break
            time.sleep(0.05)
        assert job["status"] == "completed", job
        assert job["uploaded"] == 2, job
        assert job["failed"] == 0, job
        indexed_ids = {image["id"] for image in client.get("/api/images").json()["items"]}
        before = client.get("/api/system").json()["last_inference_ms"]
        single = client.post("/api/search", json={"categories": ["bus"], "confidence": 0.5}).json()
        assert single["total"] == 1
        assert single["items"][0]["filename"] == "bus.jpg"
        conjunction = client.post("/api/search", json={"categories": ["person", "bus"], "mode": "and"}).json()
        disjunction = client.post("/api/search", json={"categories": ["person", "bus"], "mode": "or"}).json()
        assert conjunction["total"] == 1
        assert disjunction["total"] == 2
        assert client.get("/api/statistics?confidence=1").json()["total_objects"] == 0
        assert client.get("/api/system").json()["last_inference_ms"] == before
        for image in disjunction["items"]:
            for detection in image["detections"]:
                assert 0 <= detection["x1"] < detection["x2"] <= image["width"]
                assert 0 <= detection["y1"] < detection["y2"] <= image["height"]

    class NoInferenceAllowed:
        model_name = "unused"

        def predict(self, _path):
            pytest.fail("Restarted search must use persisted detections")

        def status(self):
            return {"ready": False}

    with TestClient(create_app(configuration, engine=NoInferenceAllowed())) as restarted:
        images = restarted.get("/api/images").json()
        assert {image["id"] for image in images["items"]} == indexed_ids
        assert restarted.post("/api/search", json={"categories": ["bus"]}).json()["total"] == 1
        assert restarted.delete("/api/images").status_code == 204
        assert restarted.get("/api/statistics").json()["total_images"] == 0
        assert not list(configuration.images_dir.iterdir())
        assert not list(configuration.thumbnails_dir.iterdir())

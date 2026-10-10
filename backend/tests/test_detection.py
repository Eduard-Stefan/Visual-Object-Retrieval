import builtins
import os
import sys
from contextlib import nullcontext
from pathlib import Path
from threading import Event, Thread
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.app.services.detection import DetectionEngine, DetectionError, extract_detections


class Tensor:
    def __init__(self, values):
        self.values = values

    def detach(self):
        return self

    def cpu(self):
        return self

    def tolist(self):
        return self.values


def settings(tmp_path):
    return SimpleNamespace(
        model="yolo11m.pt",
        fallback_model="yolo11s.pt",
        device="auto",
        data_dir=tmp_path,
        image_size=640,
        detection_confidence=0.15,
    )


def test_extract_metadata_clamps_boxes_and_returns_native_values():
    result = SimpleNamespace(
        boxes=SimpleNamespace(xyxy=Tensor([[-1, 2, 120, 90]]), cls=Tensor([2.0]), conf=Tensor([0.87])),
        orig_shape=(80, 100),
        names={2: "car"},
    )
    assert extract_detections(result) == [
        {
            "class_id": 2,
            "class_name": "car",
            "confidence": 0.87,
            "x1": 0.0,
            "y1": 2.0,
            "x2": 100.0,
            "y2": 80.0,
        }
    ]
    assert extract_detections(SimpleNamespace(boxes=None)) == []


def test_oom_retries_smaller_model_then_cpu(tmp_path, monkeypatch):
    engine = DetectionEngine(settings(tmp_path))
    engine.device = "cuda:0"
    engine.half = True
    engine._torch = SimpleNamespace(set_num_threads=Mock())
    monkeypatch.setattr(engine, "_configure", Mock())
    release = Mock()
    monkeypatch.setattr(engine, "_release", release)
    run = Mock(side_effect=[RuntimeError("CUDA out of memory"), RuntimeError("CUDA out of memory"), []])
    monkeypatch.setattr(engine, "_run", run)
    assert engine.predict(tmp_path / "image.jpg") == []
    assert run.call_count == 3
    assert release.call_count == 2
    assert engine.model_name == "yolo11s.pt"
    assert engine.device == "cpu"
    assert engine.half is False
    assert len(engine.warnings) == 2


def test_non_memory_failure_does_not_retry_indefinitely(tmp_path, monkeypatch):
    engine = DetectionEngine(settings(tmp_path))
    monkeypatch.setattr(engine, "_configure", Mock())
    run = Mock(side_effect=RuntimeError("Invalid tensor"))
    monkeypatch.setattr(engine, "_run", run)
    with pytest.raises(DetectionError, match="Object detection failed"):
        engine.predict(tmp_path / "image.jpg")
    assert run.call_count == 1
    assert engine.error


def test_cached_model_is_reused_and_inference_is_configured(tmp_path):
    engine = DetectionEngine(settings(tmp_path))
    engine.device = "cpu"
    engine._torch = SimpleNamespace(inference_mode=nullcontext)
    model = Mock()
    model.predict.return_value = [SimpleNamespace(boxes=None)]
    engine._model = model
    assert engine.predict(tmp_path / "first.jpg") == []
    assert engine.predict(tmp_path / "second.jpg") == []
    assert engine._model is model
    assert model.predict.call_count == 2
    options = model.predict.call_args.kwargs
    assert options["batch"] == 1
    assert options["quantize"] == 32
    assert "half" not in options
    assert options["imgsz"] == 640
    assert options["conf"] == 0.15


def fake_torch(cuda_available=True):
    return SimpleNamespace(
        __version__="test",
        version=SimpleNamespace(cuda="test"),
        cuda=SimpleNamespace(
            is_available=Mock(return_value=cuda_available),
            device_count=Mock(return_value=1),
            get_device_properties=Mock(return_value=SimpleNamespace(name="Test GPU", major=8, minor=6)),
            mem_get_info=Mock(return_value=(5 * 2**30, 6 * 2**30)),
            reset_peak_memory_stats=Mock(),
            synchronize=Mock(),
            max_memory_allocated=Mock(return_value=128 * 2**20),
            empty_cache=Mock(),
        ),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=Mock(return_value=False))),
        set_num_threads=Mock(),
        inference_mode=nullcontext,
    )


def fake_ultralytics(monkeypatch, create_model):
    yolo_settings = {}
    events = SimpleNamespace(enabled=True)
    monkeypatch.setitem(
        sys.modules, "ultralytics", SimpleNamespace(YOLO=create_model, settings=yolo_settings)
    )
    monkeypatch.setitem(sys.modules, "ultralytics.utils", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "ultralytics.utils.events", SimpleNamespace(events=events))
    return yolo_settings, events


def test_configuration_failure_leaves_no_partial_state_and_can_retry(tmp_path, monkeypatch):
    torch = fake_torch()
    monkeypatch.setitem(sys.modules, "torch", torch)
    configuration = settings(tmp_path)
    configuration.device = "cuda:9"
    engine = DetectionEngine(configuration)
    with pytest.raises(DetectionError, match="device does not exist"):
        engine._configure()
    assert engine._torch is None
    assert engine.device == "uninitialized"
    assert engine.hardware == {}
    assert engine.half is False

    configuration.device = "auto"
    engine._configure()
    assert engine._torch is torch
    assert engine.device == "cuda:0"
    assert engine.half is True
    assert engine.hardware["total_vram_mb"] == 6144


@pytest.mark.parametrize("device", ["cuda:-1", "cuda:abc", "unsupported"])
def test_invalid_device_has_actionable_status_and_does_not_poison_setup(tmp_path, monkeypatch, device):
    monkeypatch.setitem(sys.modules, "torch", fake_torch())
    configuration = settings(tmp_path)
    configuration.device = device
    engine = DetectionEngine(configuration)
    assert "inference device is invalid" in engine.status()["error"]
    assert engine._torch is None


def test_concurrent_status_cannot_observe_incomplete_configuration(tmp_path, monkeypatch):
    torch = fake_torch()
    entered_hardware_setup = Event()
    finish_hardware_setup = Event()
    status_finished = Event()
    result = {}

    def properties(_index):
        entered_hardware_setup.set()
        assert finish_hardware_setup.wait(timeout=2)
        return SimpleNamespace(name="Test GPU", major=8, minor=6)

    torch.cuda.get_device_properties.side_effect = properties
    monkeypatch.setitem(sys.modules, "torch", torch)
    engine = DetectionEngine(settings(tmp_path))

    def read_status():
        result.update(engine.status())
        status_finished.set()

    configure_thread = Thread(target=engine._configure)
    status_thread = Thread(target=read_status)
    configure_thread.start()
    try:
        assert entered_hardware_setup.wait(timeout=2)
        status_thread.start()
        assert not status_finished.wait(timeout=0.05)
        assert engine._torch is None
    finally:
        finish_hardware_setup.set()
        configure_thread.join(timeout=2)
        if status_thread.ident is not None:
            status_thread.join(timeout=2)
    assert status_finished.is_set()
    assert result["device"] == "cuda:0"
    assert result["half"] is True
    assert result["hardware"]["gpu_name"] == "Test GPU"
    assert torch.cuda.get_device_properties.call_count == 1


def test_status_does_not_wait_for_inference_lock(tmp_path):
    engine = DetectionEngine(settings(tmp_path))
    engine._torch = fake_torch()
    engine.device = "cpu"
    finished = Event()
    with engine._lock:
        thread = Thread(target=lambda: (engine.status(), finished.set()))
        thread.start()
        responsive = finished.wait(timeout=1)
    thread.join(timeout=2)
    assert responsive


def test_broken_cuda_inspection_still_allows_cpu_configuration(tmp_path, monkeypatch):
    torch = fake_torch()
    torch.cuda.mem_get_info.side_effect = RuntimeError("CUDA driver unavailable")
    monkeypatch.setitem(sys.modules, "torch", torch)
    configuration = settings(tmp_path)
    configuration.device = "cpu"
    engine = DetectionEngine(configuration)
    engine._configure()
    assert engine.device == "cpu"
    assert engine._torch is torch
    assert engine.hardware["cuda_available"] is False
    torch.set_num_threads.assert_called_once()


def test_fp16_uses_current_ultralytics_quantize_argument(tmp_path):
    engine = DetectionEngine(settings(tmp_path))
    engine._torch = fake_torch()
    engine.device = "cuda:0"
    engine.half = True
    engine._model = Mock()
    engine._model.predict.return_value = [SimpleNamespace(boxes=None)]
    assert engine.predict(tmp_path / "image.jpg") == []
    options = engine._model.predict.call_args.kwargs
    assert options["quantize"] == 16
    assert "half" not in options
    assert engine.status()["half"] is True


def test_ultralytics_config_directory_exists_before_import(tmp_path, monkeypatch):
    engine = DetectionEngine(settings(tmp_path))
    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
    model = SimpleNamespace(task="detect")

    def create_model(path):
        assert Path(os.environ["YOLO_CONFIG_DIR"]).is_dir()
        assert Path(os.environ["YOLO_CONFIG_DIR"]) == tmp_path / "ultralytics"
        assert Path(path) == tmp_path / "models" / "yolo11m.pt"
        return model

    yolo_settings, events = fake_ultralytics(monkeypatch, create_model)
    original_import = builtins.__import__

    def checked_import(name, *args, **kwargs):
        if name == "ultralytics":
            assert Path(os.environ["YOLO_CONFIG_DIR"]).is_dir()
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", checked_import)
    engine._load()
    assert engine._model is model
    assert yolo_settings == {
        "sync": False,
        "datasets_dir": str(tmp_path / "datasets"),
        "weights_dir": str(tmp_path / "models"),
        "runs_dir": str(tmp_path / "runs"),
    }
    assert events.enabled is False


def test_explicit_ultralytics_config_directory_is_created_and_preserved(tmp_path, monkeypatch):
    chosen = tmp_path / "chosen-config"
    monkeypatch.setenv("YOLO_CONFIG_DIR", str(chosen))
    fake_ultralytics(monkeypatch, lambda _: SimpleNamespace(task="detect"))
    engine = DetectionEngine(settings(tmp_path))
    engine._load()
    assert chosen.is_dir()
    assert Path(os.environ["YOLO_CONFIG_DIR"]) == chosen


def test_model_with_wrong_task_is_not_cached(tmp_path, monkeypatch):
    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
    fake_ultralytics(monkeypatch, lambda _: SimpleNamespace(task="segment"))
    engine = DetectionEngine(settings(tmp_path))
    with pytest.raises(DetectionError, match="object detection model"):
        engine._load()
    assert engine._model is None


def test_three_failed_attempts_stop_and_cpu_oom_does_not_retry(tmp_path, monkeypatch):
    engine = DetectionEngine(settings(tmp_path))
    engine.device = "cuda:0"
    engine._torch = fake_torch()
    monkeypatch.setattr(engine, "_release", Mock())
    run = Mock(side_effect=RuntimeError("CUDA out of memory"))
    monkeypatch.setattr(engine, "_run", run)
    with pytest.raises(DetectionError):
        engine.predict(tmp_path / "image.jpg")
    assert run.call_count == 3
    assert engine.device == "cpu"

    run.reset_mock()
    with pytest.raises(DetectionError):
        engine.predict(tmp_path / "image.jpg")
    assert run.call_count == 1


def test_broken_cuda_cache_cleanup_does_not_block_recovery(tmp_path):
    engine = DetectionEngine(settings(tmp_path))
    engine._torch = fake_torch()
    engine._torch.cuda.empty_cache.side_effect = RuntimeError("CUDA context failed")
    engine._model = Mock()
    engine._release()
    assert engine._model is None


@pytest.mark.inference
@pytest.mark.skipif(os.environ.get("VOR_RUN_INFERENCE_TEST") != "1", reason="Real inference is opt in")
def test_real_yolo_smoke(tmp_path):
    from PIL import Image
    from backend.app.core.config import Settings

    image = tmp_path / "blank.jpg"
    Image.new("RGB", (640, 480), "white").save(image)
    # Use the configured data directory to reuse cached weights.
    engine = DetectionEngine(Settings())
    assert isinstance(engine.predict(image), list)
    assert engine.status()["ready"] is True

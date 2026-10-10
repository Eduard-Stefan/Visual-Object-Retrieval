"""One cached YOLO model, serialized inference, and bounded device recovery."""

from __future__ import annotations

import gc
import logging
import os
from pathlib import Path
from threading import RLock
from time import perf_counter

logger = logging.getLogger(__name__)


class DetectionError(RuntimeError):
    """An actionable inference failure safe to display in the application."""


def extract_detections(result) -> list[dict]:
    """Detach YOLO tensors immediately; retain only JSON-safe pixel coordinates."""
    if result.boxes is None:
        return []
    boxes = result.boxes
    coordinates = boxes.xyxy.detach().cpu().tolist()
    classes = boxes.cls.detach().cpu().tolist()
    confidences = boxes.conf.detach().cpu().tolist()
    height, width = result.orig_shape
    output = []
    for xyxy, class_value, confidence in zip(coordinates, classes, confidences, strict=True):
        class_id = int(class_value)
        x1, y1, x2, y2 = xyxy
        output.append(
            {
                "class_id": class_id,
                "class_name": result.names[class_id],
                "confidence": float(confidence),
                "x1": max(0.0, min(float(x1), width)),
                "y1": max(0.0, min(float(y1), height)),
                "x2": max(0.0, min(float(x2), width)),
                "y2": max(0.0, min(float(y2), height)),
            }
        )
    return output


class DetectionEngine:
    def __init__(self, settings):
        self.settings = settings
        self._lock = RLock()
        # Hardware setup is short and independent of the potentially slow
        # inference lock. Status reads can wait for setup without waiting for YOLO.
        self._configuration_lock = RLock()
        self._model = None
        self._torch = None
        self.model_name = settings.model
        self.device = "uninitialized"
        self.half = False
        self.ready = False
        self.error = None
        self.warnings: list[str] = []
        self.hardware: dict = {}
        self.last_inference_ms = None
        self.peak_vram_mb = None

    def _warn(self, message):
        if message not in self.warnings:
            self.warnings.append(message)
            logger.warning(message)

    def _inspect_hardware(self, torch, index):
        hardware = {
            "torch_version": torch.__version__,
            "cuda_version": torch.version.cuda,
            "cuda_available": torch.cuda.is_available(),
        }
        if not hardware["cuda_available"]:
            return hardware, None, None
        if index >= torch.cuda.device_count():
            raise DetectionError("The configured CUDA device does not exist. Set VOR_DEVICE=auto or cpu.")
        try:
            properties = torch.cuda.get_device_properties(index)
            free, total = torch.cuda.mem_get_info(index)
            hardware.update(
                {
                    "gpu_name": properties.name,
                    "total_vram_mb": round(total / 2**20),
                    "free_vram_mb": round(free / 2**20),
                    "compute_capability": f"{properties.major}.{properties.minor}",
                }
            )
            return hardware, properties, None
        except Exception:
            # Even a nominally available CUDA driver can fail during
            # initialization. Explicit CPU configuration must still work.
            logger.exception("CUDA hardware inspection failed; using CPU fallback")
            hardware["cuda_available"] = False
            return hardware, None, "CUDA hardware initialization failed; GPU information is unavailable."

    @staticmethod
    def _device_options(torch, requested, index, hardware, properties, warning):
        cuda_index = requested.removeprefix("cuda:")
        mps = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        if requested == "cpu":
            return "cpu", False, warning
        if (requested in {"auto", "cuda"} or cuda_index.isdecimal()) and hardware["cuda_available"]:
            return f"cuda:{index}", properties.major >= 6, warning
        if requested in {"auto", "mps"} and mps:
            return "mps", False, warning
        return (
            "cpu",
            False,
            warning or "GPU acceleration is unavailable for this PyTorch build. Using CPU inference.",
        )

    def _configure(self):
        with self._configuration_lock:
            if self._torch is not None:
                return
            import torch

            requested = str(self.settings.device).strip().lower()
            cuda_index = requested.removeprefix("cuda:")
            if requested not in {"auto", "cpu", "mps", "cuda"} and not cuda_index.isdecimal():
                raise DetectionError(
                    "The inference device is invalid. Use auto, cpu, mps, cuda, or a CUDA index such as cuda:0."
                )
            index = int(cuda_index) if cuda_index.isdecimal() else 0
            hardware, properties, warning = self._inspect_hardware(torch, index)
            device, half, warning = self._device_options(
                torch, requested, index, hardware, properties, warning
            )
            if device == "cpu":
                torch.set_num_threads(min(4, os.cpu_count() or 1))

            # Publish only a complete configuration. A failed setup stays
            # retryable, and concurrent callers never see a premature sentinel.
            self.hardware = hardware
            self.device = device
            self.half = half
            self.error = None
            if warning:
                self._warn(warning)
            self._torch = torch

    def _load(self):
        try:
            # Ultralytics checks writability during import and otherwise falls
            # back to a directory in the working tree. Create the chosen path first.
            config_dir = Path(os.environ.get("YOLO_CONFIG_DIR") or self.settings.data_dir / "ultralytics")
            config_dir = config_dir.expanduser().resolve()
            config_dir.mkdir(parents=True, exist_ok=True)
            os.environ["YOLO_CONFIG_DIR"] = str(config_dir)
            from ultralytics import YOLO, settings as yolo_settings
            from ultralytics.utils.events import events

            yolo_settings.update(
                {
                    "sync": False,
                    "datasets_dir": str(self.settings.data_dir / "datasets"),
                    "weights_dir": str(self.settings.data_dir / "models"),
                    "runs_dir": str(self.settings.data_dir / "runs"),
                }
            )
            # The singleton may have been created during import before settings
            # were changed. Disable it directly before loading or predicting.
            events.enabled = False

            model_path = Path(self.model_name)
            if model_path.name == self.model_name:
                model_path = self.settings.data_dir / "models" / self.model_name
            model_path.parent.mkdir(parents=True, exist_ok=True)
            model = YOLO(str(model_path))
            if model.task != "detect":
                raise DetectionError("VOR_MODEL must be an object detection model, such as yolo11m.pt.")
            self._model = model
        except DetectionError:
            raise
        except Exception as exc:
            logger.exception("Could not load YOLO weights")
            raise DetectionError(
                f"Could not download or load {self.model_name}. Check your internet connection, "
                "or place trusted Ultralytics weights in data/models and retry the image."
            ) from exc

    def _release(self):
        self._model = None
        self.ready = False
        gc.collect()
        if self._torch is not None and self._torch.cuda.is_available():
            try:
                self._torch.cuda.empty_cache()
            except RuntimeError:
                # A failed CUDA context must not prevent the CPU recovery path.
                logger.warning("Could not clear GPU cache during recovery", exc_info=True)

    def _run(self, path):
        if self._model is None:
            self._load()
        cuda = self.device.startswith("cuda")
        if cuda:
            self._torch.cuda.reset_peak_memory_stats(self.device)
            self._torch.cuda.synchronize(self.device)
        start = perf_counter()
        with self._torch.inference_mode():
            results = self._model.predict(
                source=str(path),
                device=self.device,
                quantize=16 if self.half else 32,
                batch=1,
                imgsz=self.settings.image_size,
                conf=self.settings.detection_confidence,
                verbose=False,
                save=False,
                stream=False,
                max_det=300,
            )
        if cuda:
            self._torch.cuda.synchronize(self.device)
            self.peak_vram_mb = round(self._torch.cuda.max_memory_allocated(self.device) / 2**20, 1)
        self.last_inference_ms = round((perf_counter() - start) * 1000, 1)
        output = extract_detections(results[0])
        del results
        self.ready = True
        self.error = None
        return output

    def _recover_acceleration(self, error: RuntimeError, attempt: int) -> bool:
        message = str(error).lower()
        accelerated = self.device.startswith("cuda") or self.device == "mps"
        accelerator_error = accelerated and any(
            term in message for term in ("cuda", "cudnn", "cublas", "mps", "metal", "out of memory")
        )
        if attempt == 2 or not accelerator_error:
            return False
        # Failed prediction frames may retain GPU tensors. Drop the traceback
        # before releasing the cached model.
        error.__traceback__ = None
        self._release()
        if "out of memory" in message and self.model_name != self.settings.fallback_model:
            self.model_name = self.settings.fallback_model
            self._warn(f"GPU memory was exhausted. Retrying with {self.model_name}.")
        else:
            with self._configuration_lock:
                self.device = "cpu"
                self.half = False
            self._torch.set_num_threads(min(4, os.cpu_count() or 1))
            self._warn("GPU inference failed. Retrying on CPU; inference may be slower.")
        return True

    def predict(self, path: Path) -> list[dict]:
        with self._lock:
            try:
                self._configure()
                # At most three attempts: preferred model, smaller model, then CPU.
                for attempt in range(3):
                    try:
                        return self._run(path)
                    except DetectionError:
                        raise
                    except RuntimeError as exc:
                        if not self._recover_acceleration(exc, attempt):
                            raise
                raise DetectionError("Inference recovery was exhausted. Restart the backend and retry.")
            except Exception as exc:
                self.ready = False
                self.error = (
                    str(exc)
                    if isinstance(exc, DetectionError)
                    else ("Object detection failed. Check the backend log and retry the image.")
                )
                logger.exception("Inference failed")
                raise DetectionError(self.error) from exc

    def status(self) -> dict:
        # Do not take the inference lock: progress and health must remain responsive.
        try:
            self._configure()
        except Exception as exc:
            logger.exception("Hardware inspection failed")
            self.error = (
                str(exc)
                if isinstance(exc, DetectionError)
                else ("Hardware inspection failed. Check the PyTorch installation.")
            )
        with self._configuration_lock:
            return {
                "model": self.model_name,
                "device": self.device,
                "half": self.half,
                "ready": self.ready,
                "error": self.error,
                "hardware": self.hardware.copy(),
                "warnings": self.warnings.copy(),
                "last_inference_ms": self.last_inference_ms,
                "peak_vram_mb": self.peak_vram_mb,
            }

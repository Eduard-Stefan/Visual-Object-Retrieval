"""Inspect acceleration and benchmark the real detection pipeline locally."""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.core.config import Settings  # noqa: E402
from backend.app.services.detection import DetectionEngine  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, help="Optional local photograph; default is a blank smoke image")
    parser.add_argument("--model", default="yolo11m.pt")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    settings = Settings(model=args.model)
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = DetectionEngine(settings)
    try:
        driver = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader"],
            text=True, timeout=10).strip()
    except (FileNotFoundError, subprocess.SubprocessError):
        driver = "nvidia-smi unavailable"
    with tempfile.TemporaryDirectory(dir=settings.data_dir, prefix="probe-") as temporary:
        path = args.image
        if path is None:
            from PIL import Image
            path = Path(temporary) / "blank.jpg"
            Image.new("RGB", (960, 640), (230, 234, 240)).save(path)
        start = perf_counter()
        detections = engine.predict(path)
        cold_seconds = perf_counter() - start
        timings = []
        for _ in range(args.runs):
            start = perf_counter()
            detections = engine.predict(path)
            timings.append(round((perf_counter() - start) * 1000, 2))
    report = {"driver": driver, **engine.status(), "image_kind": "photograph" if args.image else "blank smoke image",
              "image_size": settings.image_size, "batch_size": 1, "cold_start_seconds": round(cold_seconds, 2),
              "warm_pipeline_ms": timings, "median_pipeline_ms": round(statistics.median(timings), 2),
              "detection_count": len(detections), "detections": detections}
    content = json.dumps(report, indent=2)
    print(content)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

# Hardware verification

Measured on 10 October 2026 on the user's Windows workstation. These are local smoke measurements, not dataset accuracy or comparative model benchmarks.

| Item | Observed value |
| --- | --- |
| GPU | NVIDIA GeForce RTX 4050 Laptop GPU |
| Reported physical VRAM | 6,141 MiB (`nvidia-smi`) |
| Free VRAM before photo probe | 5,251 MiB (changes with desktop applications) |
| NVIDIA driver | 591.66 |
| Driver CUDA capability | 13.1 |
| Python | 3.14.0 |
| PyTorch / torchvision | 2.11.0+cu128 / 0.26.0+cu128 |
| PyTorch CUDA runtime | 12.8 |
| CUDA available | Yes |
| Compute capability | 8.9 |
| Ultralytics | 8.4.175 |
| Selected model | YOLO11m (`yolo11m.pt`) |
| Device / precision | `cuda:0`, FP16 |
| Resize target / batch | 640 / 1 |

## Real photograph test

Command from repository root:

```powershell
.\.venv\Scripts\python.exe scripts/hardware_probe.py --image .venv/Lib/site-packages/ultralytics/assets/bus.jpg --runs 5 --output data/hardware-photo.json
```

This uses the locally installed Ultralytics smoke photograph; no photo is committed to this repository. Five objects were extracted at confidence 0.15: one bus and four people. Their scores ranged from approximately 0.787 to 0.927. These are model scores, not manually assessed accuracy.

- First inference including model loading and CUDA warm-up with cached weights: **5.33 s**.
- Five warm, complete detection service calls: **22.36, 21.04, 20.56, 21.10, 21.70 ms**.
- Median warm call: **21.10 ms**.
- PyTorch peak allocated tensor memory during the last inference: **110.1 MiB**.

The tensor memory counter excludes CUDA context, cuDNN workspace, allocator reservations and other applications; it must not be interpreted as total GPU consumption. Timing includes image reading, preprocessing, inference, postprocessing and metadata conversion, but excludes API upload, thumbnail generation and database transactions. Laptop power state, image dimensions and other applications affect results.

The earlier blank-image smoke test also succeeded: 41.40 ms median warm call and no detections, as expected. Cold loading with the initial weight download took 15.62 s. Rectangular image padding changes inference work with input aspect ratio, so these two inputs are not comparable performance benchmarks.

## Decision

YOLO11m ran reliably on the actual 6 GB GPU with CUDA and FP16. It remains the preferred default. There was no reason to downgrade to YOLO11s or a nano model. Out-of-memory recovery is exercised with deterministic tests rather than intentionally exhausting the user's GPU. YOLO11s and CPU remain runtime recovery paths.

The application uses the supported FP16 inference option (`quantize=16` in pinned Ultralytics 8.4.175), serializes all inference and retains one cached model. Consult [official PyTorch installation commands](https://pytorch.org/get-started/previous-versions/) and [Ultralytics inference documentation](https://docs.ultralytics.com/modes/predict/) when changing dependency versions.

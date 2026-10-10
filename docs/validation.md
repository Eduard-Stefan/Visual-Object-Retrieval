# Executed validation

Validated on 10 October 2026 in the `Visual-Object-Retrieval` repository on `main`, with an NVIDIA RTX 4050 Laptop GPU. These results describe executed software checks and local inference observations, not a large-scale accuracy benchmark.

| Check | Command from repository root unless noted | Result |
| --- | --- | --- |
| Backend, detector and evaluation tests, including real inference | Set `VOR_RUN_INFERENCE_TEST=1`, then `.venv/Scripts/python.exe -m pytest -q` | **68 passed** |
| Python static checks | `.venv/Scripts/python.exe -m ruff check backend scripts` | Passed |
| Python formatting | `.venv/Scripts/python.exe -m ruff format --check backend scripts` | Passed |
| Python dependency compatibility | `.venv/Scripts/python.exe -m pip check` | No broken requirements |
| Frontend component/API tests | In `frontend`, `npm test` | **33 passed in 5 suites** |
| TypeScript checking | In `frontend`, `npm run typecheck` | Passed |
| Frontend formatting | In `frontend`, `npm run format:check` | Passed |
| Production build, including TypeScript | In `frontend`, `npm run build` | Passed |
| Frontend dependency audit | In `frontend`, `npm audit --json` | **0 vulnerabilities**, including development dependencies |
| Real browser workflow | In `frontend`, `npx playwright test` | **1 passed** in installed Microsoft Edge |
| Real CUDA model benchmark | `scripts/hardware_probe.py --image .../ultralytics/assets/bus.jpg --runs 5` | YOLO11m, CUDA FP16, median **21.10 ms** warm service call |

The standard backend command without the opt-in flag skips the two tests that run actual YOLO. The real test run above enabled both; no backend tests were skipped. Starlette emitted one dependency deprecation warning about its HTTPX test-client integration; tests passed.

## Backend coverage

Tests verify supported formats, corrupt/unsupported/empty files, pixel and byte limits, file count and streamed request body limits, safe filenames, EXIF orientation, alpha compositing, thumbnails, image records, confidence metadata, hash uniqueness and concurrent duplicate uploads. They cover database-only single-object/AND/OR queries, unknown classes, inclusive confidence boundaries, deterministic sorting, pagination, matching confidence, category and statistics consistency, file access, deletion/cascades, clearing, failed-image retries, safe model errors, queue recovery and cancellation during inference.

Detector tests verify metadata conversion, cached model reuse, batch/precision options, configuration races, partial initialization recovery, CPU fallback, bounded CUDA out-of-memory recovery, unsupported model errors, local Ultralytics settings and responsive status reads.

Evaluation tests verify precision/recall/F1 calculations and undefined cases, strict reviewed labels, unique filenames, complete collection coverage, hashes, pagination, query construction and observable collection changes. Test fixtures are artificial software checks; their values are not reported as detector accuracy.

## Real inference and persistence

The opt-in real pipeline test uploads the two photographs supplied by the installed Ultralytics package into an isolated temporary collection. It verifies successful detection/indexing, bus retrieval, person AND bus, person OR bus, confidence filtering, valid box coordinates, and that search leaves the inference timestamp unchanged.

It closes the application, reopens the same SQLite collection with an engine that refuses all inference, and confirms that image IDs and bus results persist. It then clears the collection and verifies file cleanup. Thus persistence and retrieval after a backend restart are checked using actual detections.

## Browser and visual checks

The browser test uses a separate `data/browser-tests` collection and backend on port 8001. It exercises multi-file selection and preview, real indexing, dropdown population, single-object results, SVG annotations, detail viewing, original toggle, Escape dismissal, AND/OR controls, confidence 100%, sorting, page refresh persistence, deletion confirmation and collection clearing. It also checks that a 390-pixel mobile viewport has no horizontal overflow and that no uncaught browser errors occur.

Desktop and mobile screenshots were visually inspected. Real result/detail screenshots were inspected locally for alignment of boxes on the bus and people; those photograph-containing screenshots remain under ignored `data/`. Committed [desktop](screenshots/dashboard.png) and [mobile](screenshots/mobile.png) screenshots show the empty interface and contain no sample photographs.

The development frontend was also started on port 5173: its page, proxied health endpoint and proxied CUDA system details returned successfully. Vite's development proxy targets `127.0.0.1:8000`; the production build is served by FastAPI at the same origin.

## Windows launcher checks

The batch launchers were exercised with Windows PowerShell 5.1, Python 3.14 and Node.js 24.11.1:

- A clean copy of the tracked project files plus the launchers, with no `.venv`, `node_modules`, built interface or `.env`, completed setup using `start.bat -Cpu -NoBrowser -Port 8012`. It installed the CPU PyTorch build, downloaded YOLO11m on the first upload and successfully indexed two real sample photographs.
- Repeated start reused the existing server. Repeated stop was harmless. A subsequent start skipped unchanged setup, and image records persisted across shutdown and restart.
- Launching from another directory with spaces in the repository path worked. Capturing the batch command's output also returned promptly while the background server stayed healthy.
- An unrelated occupied port, a stale record pointing at an unrelated process with a matching creation timestamp, and corrupt launcher state were handled without stopping the unrelated process.
- A deliberately invalid frontend lock file failed setup without starting a server or updating the successful build marker. Restoring the lock file and changing a source file triggered a successful rebuild. Startup and graceful shutdown appeared in the server logs.
- The user's existing CUDA environment was retained. Restarting the main collection under the launcher preserved all 50 image IDs and hashes, its 114 detected objects and 30 categories at confidence 0.5. The system still selected `cuda:0` with FP16.

The standard backend regression suite passed again: **66 passed, 2 opt-in inference tests skipped**. Ruff checks and formatting passed. The clean-copy uploads used actual CPU inference; temporary test images and environments are excluded from Git.

## Scope and limits

YOLO11m was tested on the user's actual CUDA hardware and retained because it ran reliably. Recovery tests simulate out-of-memory conditions; the user's GPU was not deliberately exhausted. The measured sample latency excludes upload/database overhead and is not a claim about arbitrary images or devices. See [hardware details](hardware-verification.md).

No independent 30–50-image relevance dataset is bundled. Use the [demo preparation guide](demo-dataset.md) and [manual evaluation procedure](evaluation.md) to obtain defensible precision/recall values for an academic presentation.

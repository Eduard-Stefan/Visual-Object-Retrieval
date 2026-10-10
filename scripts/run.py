"""Serve the built React application and FastAPI together on localhost."""

import argparse
from contextlib import ExitStack
import sys
from pathlib import Path
from threading import Event, Thread

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--shutdown-file", type=Path, help="Local launcher control file for graceful shutdown"
    )
    parser.add_argument("--log-dir", type=Path, help="Write server output to this directory")
    args = parser.parse_args()
    with ExitStack() as logs:
        original_stdout, original_stderr = sys.stdout, sys.stderr
        try:
            if args.log_dir:
                args.log_dir.mkdir(parents=True, exist_ok=True)
                sys.stdout = logs.enter_context(
                    (args.log_dir / "server.stdout.log").open("w", encoding="utf-8", buffering=1)
                )
                sys.stderr = logs.enter_context(
                    (args.log_dir / "server.stderr.log").open("w", encoding="utf-8", buffering=1)
                )
            serve(args, parser)
        finally:
            sys.stdout, sys.stderr = original_stdout, original_stderr


def serve(args, parser):
    if not (ROOT / "frontend" / "dist" / "index.html").exists():
        parser.exit(1, "Build the interface first: cd frontend; npm ci; npm run build\n")
    import uvicorn

    server = uvicorn.Server(
        uvicorn.Config("backend.app.main:app", host="127.0.0.1", port=args.port, workers=1)
    )
    finished = Event()

    def watch_shutdown():
        while not finished.wait(0.25):
            if args.shutdown_file.is_file():
                server.should_exit = True
                return

    if args.shutdown_file:
        Thread(target=watch_shutdown, name="launcher-shutdown", daemon=True).start()
    try:
        server.run()
    finally:
        finished.set()


if __name__ == "__main__":
    main()

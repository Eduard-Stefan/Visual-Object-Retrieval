"""Serve the built React application and FastAPI together on localhost."""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not (ROOT / "frontend" / "dist" / "index.html").exists():
        parser.exit(1, "Build the interface first: cd frontend; npm ci; npm run build\n")
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=args.port, workers=1)


if __name__ == "__main__":
    main()

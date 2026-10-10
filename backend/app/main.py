"""FastAPI application factory and local production frontend hosting."""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .api.routes import router
from .api.upload_limits import UploadBodyLimitMiddleware
from .core.config import Settings
from .database import Database
from .services.indexing import Detector, IndexingService


logger = logging.getLogger(__name__)


def application_lifespan(configuration: Settings, engine: Detector | None):
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        database = Database(configuration)
        database.initialize()
        detector = engine
        if detector is None:
            # Import lazily so API tests do not import PyTorch or download weights.
            from .services.detection import DetectionEngine

            detector = DetectionEngine(configuration)
        indexer = IndexingService(database, configuration, detector)
        application.state.database = database
        application.state.engine = detector
        application.state.indexer = indexer
        indexer.start()
        try:
            yield
        finally:
            indexer.stop()
            if not indexer.thread or not indexer.thread.is_alive():
                database.engine.dispose()

    return lifespan


def invalid_request(_request: Request, error: RequestValidationError):
    messages = [
        f"{'.'.join(str(part) for part in entry['loc'][1:])}: {entry['msg']}" for entry in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": "Invalid request. " + " ".join(messages[:3])})


def unexpected_error(_request: Request, error: Exception):
    logger.exception("Unexpected API error", exc_info=error)
    return JSONResponse(
        status_code=500,
        content={"detail": "The request could not be completed. Check the backend log and try again."},
    )


def register_frontend(application: FastAPI, configuration: Settings):
    @application.get("/", include_in_schema=False)
    def home():
        index = configuration.frontend_dist / "index.html"
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return {
            "message": "Visual Object Retrieval API is running. Start the frontend or build frontend/dist.",
            "docs": "/docs",
        }

    @application.get("/{asset_path:path}", include_in_schema=False)
    def frontend_asset(asset_path: str):
        if asset_path == "api" or asset_path.startswith("api/"):
            raise HTTPException(404, "This API endpoint was not found.")
        root = configuration.frontend_dist.resolve()
        candidate = (root / asset_path).resolve()
        if not candidate.is_relative_to(root):
            raise HTTPException(404, "This page was not found.")
        if candidate.is_file():
            return FileResponse(candidate)
        index = root / "index.html"
        if index.is_file() and "." not in asset_path.rsplit("/", 1)[-1]:
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        raise HTTPException(404, "This page was not found.")


def create_app(settings: Settings | None = None, engine: Detector | None = None) -> FastAPI:
    configuration = settings or Settings()
    application = FastAPI(
        title="Visual Object Retrieval",
        description="Persistent YOLO object indexing and semantic image retrieval.",
        version="1.0.0",
        lifespan=application_lifespan(configuration, engine),
    )
    application.state.settings = configuration
    application.add_middleware(UploadBodyLimitMiddleware, max_body_mb=configuration.max_upload_body_mb)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=configuration.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )
    application.include_router(router)

    application.add_exception_handler(RequestValidationError, invalid_request)
    application.add_exception_handler(Exception, unexpected_error)
    register_frontend(application, configuration)
    return application


app = create_app()

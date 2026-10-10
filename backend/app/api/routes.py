"""Local collection management and indexed retrieval endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..models import ImageRecord, JobRecord
from ..schemas import Category, Detection, Image, ImagePage, Job, SearchRequest, SortOrder, Statistics, UploadAccepted
from ..services.image_processing import GENERATED_FILENAME
from ..services.retrieval import categories, get_detections, image_payload, search_images, statistics


router = APIRouter(prefix="/api")
Confidence = Annotated[float, Query(ge=0, le=1)]


def get_session(request: Request):
    with request.app.state.database.session() as session:
        yield session


SessionDependency = Annotated[Session, Depends(get_session)]


def find_image(session: Session, image_id: str) -> ImageRecord:
    image = session.get(ImageRecord, image_id)
    if not image:
        raise HTTPException(404, "This image was not found.")
    return image


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/system")
def system(request: Request):
    settings = request.app.state.settings
    return {
        **request.app.state.engine.status(),
        "detection_confidence": settings.detection_confidence,
        "image_size": settings.image_size,
        "max_upload_files": settings.max_upload_files,
        "max_upload_body_mb": settings.max_upload_body_mb,
        "max_file_mb": settings.max_file_mb,
        "max_image_pixels": settings.max_image_pixels,
    }


@router.post("/images/upload", response_model=UploadAccepted, status_code=202)
def upload_images(request: Request, files: Annotated[list[UploadFile], File()]):
    job = request.app.state.indexer.accept_upload(files)
    return UploadAccepted(job_id=job.id, total=job.total)


@router.get("/jobs/{job_id}", response_model=Job)
def job_status(job_id: str, session: SessionDependency):
    job = session.get(JobRecord, job_id)
    if not job:
        raise HTTPException(404, "This processing job was not found.")
    result = {
        "id": job.id, "status": "queued" if job.status == "uploading" else job.status,
        "total": job.total, "processed": job.processed, "uploaded": job.uploaded,
        "duplicates": job.duplicates, "failed": job.failed, "errors": job.errors,
    }
    return Job(**result)


@router.get("/images", response_model=ImagePage)
def list_images(
    session: SessionDependency,
    confidence: Confidence = 0.5,
    sort: SortOrder = "newest",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
):
    return search_images(session, SearchRequest(confidence=confidence, sort=sort, page=page, page_size=page_size))


@router.delete("/images", status_code=204)
def clear_images(request: Request):
    request.app.state.indexer.clear()
    return Response(status_code=204)


@router.get("/images/{image_id}", response_model=Image)
def image_detail(image_id: str, session: SessionDependency, confidence: Confidence = 0.5):
    image = find_image(session, image_id)
    detections = get_detections(session, [image_id], confidence)[image_id]
    return image_payload(image, detections)


@router.get("/images/{image_id}/detections", response_model=list[Detection])
def image_detections(image_id: str, session: SessionDependency, confidence: Confidence = 0.5):
    find_image(session, image_id)
    return get_detections(session, [image_id], confidence)[image_id]


def stored_file(request: Request, session: Session, image_id: str, thumbnail: bool):
    image = find_image(session, image_id)
    settings = request.app.state.settings
    directory = settings.thumbnails_dir if thumbnail else settings.images_dir
    if not GENERATED_FILENAME.fullmatch(image.stored_filename):
        raise HTTPException(404, "This image file is unavailable.")
    path = directory / image.stored_filename
    if not path.resolve().is_relative_to(directory.resolve()) or not path.is_file():
        raise HTTPException(404, "This image file is unavailable.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/images/{image_id}/file")
def image_file(request: Request, image_id: str, session: SessionDependency):
    return stored_file(request, session, image_id, thumbnail=False)


@router.get("/images/{image_id}/thumbnail")
def image_thumbnail(request: Request, image_id: str, session: SessionDependency):
    return stored_file(request, session, image_id, thumbnail=True)


@router.delete("/images/{image_id}", status_code=204)
def delete_image(request: Request, image_id: str):
    request.app.state.indexer.delete_image(image_id)
    return Response(status_code=204)


@router.post("/images/{image_id}/retry", response_model=UploadAccepted, status_code=202)
def retry_image(request: Request, image_id: str):
    job = request.app.state.indexer.retry(image_id)
    return UploadAccepted(job_id=job.id, total=job.total)


@router.get("/search/categories", response_model=list[Category])
def available_categories(session: SessionDependency, confidence: Confidence = 0.5):
    return categories(session, confidence)


@router.post("/search", response_model=ImagePage)
def search(query: SearchRequest, session: SessionDependency):
    return search_images(session, query)


@router.get("/statistics", response_model=Statistics)
def collection_statistics(session: SessionDependency, confidence: Confidence = 0.5):
    return statistics(session, confidence)

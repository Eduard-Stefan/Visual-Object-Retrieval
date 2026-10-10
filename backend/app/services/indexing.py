"""Durable, bounded upload jobs processed by one inference worker."""

from collections.abc import Iterable
import logging
import math
from pathlib import Path
import threading
from typing import Protocol
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy import delete, func, select

from ..core.config import Settings
from ..database import Database
from ..models import DetectionRecord, ImageRecord, JobRecord
from .image_processing import (
    GENERATED_FILENAME,
    PreparedImage,
    prepare_image,
    remove_stored_image,
    safe_filename,
    store_image,
)


logger = logging.getLogger(__name__)


class Detector(Protocol):
    model_name: str

    def predict(self, path: Path) -> list[dict]: ...

    def status(self) -> dict: ...


def finish_job(job: JobRecord) -> None:
    if job.processed >= job.total:
        job.status = "completed" if job.uploaded or job.duplicates else "failed"


class IndexingService:
    def __init__(self, database: Database, settings: Settings, detector: Detector):
        self.database = database
        self.settings = settings
        self.detector = detector
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.stopping = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        self._recover()
        self.thread = threading.Thread(target=self._run, name="image-indexer", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stopping.set()
        self.wake.set()
        if self.thread:
            # In-flight inference may finish later; its transaction remains recoverable.
            self.thread.join(timeout=3)

    def _recover(self) -> None:
        with self.lock, self.database.session.begin() as session:
            for image in session.scalars(select(ImageRecord).where(ImageRecord.status == "processing")):
                image.status = "queued"
            session.flush()
            active = session.scalars(
                select(JobRecord).where(JobRecord.status.in_(["uploading", "queued", "processing"]))
            )
            for job in active:
                pending = (
                    session.scalar(
                        select(func.count())
                        .select_from(ImageRecord)
                        .where(ImageRecord.job_id == job.id, ImageRecord.status == "queued")
                    )
                    or 0
                )
                missing = max(job.total - job.processed - pending, 0)
                if missing:
                    job.processed += missing
                    job.failed += missing
                    job.errors = [
                        *job.errors,
                        f"{missing} upload(s) were interrupted before storage completed. Please upload them again.",
                    ]
                job.status = "queued"
                finish_job(job)
            known = set(session.scalars(select(ImageRecord.stored_filename)))
        # Only generated image files are eligible for crash-cleanup.
        for directory in (self.settings.images_dir, self.settings.thumbnails_dir):
            for path in directory.iterdir():
                if path.is_file() and (
                    (GENERATED_FILENAME.fullmatch(path.name) and path.name not in known)
                    or (path.suffix == ".tmp" and GENERATED_FILENAME.fullmatch(path.with_suffix(".jpg").name))
                ):
                    path.unlink(missing_ok=True)

    def accept_upload(self, files: list[UploadFile]) -> JobRecord:
        if not files:
            raise HTTPException(400, "Choose at least one image to upload.")
        if len(files) > self.settings.max_upload_files:
            raise HTTPException(413, f"Upload at most {self.settings.max_upload_files} images at a time.")
        with self.lock, self.database.session.begin() as session:
            pending = (
                session.scalar(
                    select(func.coalesce(func.sum(JobRecord.total - JobRecord.processed), 0)).where(
                        JobRecord.status.in_(["uploading", "queued", "processing"])
                    )
                )
                or 0
            )
            if pending + len(files) > self.settings.max_pending_images:
                raise HTTPException(
                    429, "The processing queue is full. Wait for the current batch to finish and try again."
                )
            job = JobRecord(id=str(uuid4()), total=len(files))
            session.add(job)
            session.flush()
            job_id = job.id

        for upload in files:
            self._accept_file(job_id, upload)

        with self.lock, self.database.session.begin() as session:
            job = session.get(JobRecord, job_id)
            if job.status != "uploading":
                raise HTTPException(
                    409, "The collection was cleared during the upload. Please upload the images again."
                )
            job.status = "queued"
            finish_job(job)
            no_valid_images = job.status == "failed"
            errors = job.errors
        self.wake.set()
        if no_valid_images:
            raise HTTPException(400, "No valid images were uploaded. " + " ".join(errors[:3]))
        return job

    def _store_prepared_upload(self, job_id: str, prepared: PreparedImage) -> None:
        with self.lock, self.database.session.begin() as session:
            job = session.get(JobRecord, job_id)
            if job.status != "uploading":
                raise HTTPException(
                    409,
                    "The collection was cleared during the upload. Please upload the images again.",
                )
            duplicate = session.scalar(
                select(ImageRecord.id).where(ImageRecord.file_hash == prepared.file_hash)
            )
            if duplicate:
                job.processed += 1
                job.duplicates += 1
                return
            image_id = str(uuid4())
            stored_filename = f"{image_id}.jpg"
            store_image(prepared, stored_filename, self.settings)
            session.add(
                ImageRecord(
                    id=image_id,
                    filename=prepared.filename,
                    stored_filename=stored_filename,
                    file_hash=prepared.file_hash,
                    width=prepared.image.width,
                    height=prepared.image.height,
                    status="queued",
                    job_id=job_id,
                )
            )

    def _accept_file(self, job_id: str, upload: UploadFile) -> None:
        prepared = None
        try:
            payload = upload.file.read(self.settings.max_file_mb * 1024 * 1024 + 1)
            prepared = prepare_image(upload.filename, payload, self.settings)
            del payload
            self._store_prepared_upload(job_id, prepared)
        except HTTPException:
            raise
        except Exception as error:
            if isinstance(error, ValueError):
                message = str(error)
            else:
                logger.exception("Could not store uploaded image")
                message = "The image could not be stored. Check that the data directory has free space and is writable."
            with self.lock, self.database.session.begin() as session:
                job = session.get(JobRecord, job_id)
                if job.status == "uploading":
                    job.processed += 1
                    job.failed += 1
                    job.errors = [*job.errors, f"{safe_filename(upload.filename)}: {message}"]
        finally:
            if prepared:
                prepared.image.close()
            upload.file.close()

    def retry(self, image_id: str) -> JobRecord:
        with self.lock, self.database.session.begin() as session:
            image = session.get(ImageRecord, image_id)
            if not image:
                raise HTTPException(404, "This image was not found.")
            if image.status != "failed":
                raise HTTPException(409, "Only images whose indexing failed can be retried.")
            pending = (
                session.scalar(
                    select(func.coalesce(func.sum(JobRecord.total - JobRecord.processed), 0)).where(
                        JobRecord.status.in_(["uploading", "queued", "processing"])
                    )
                )
                or 0
            )
            if pending >= self.settings.max_pending_images:
                raise HTTPException(
                    429, "The processing queue is full. Try again after the current batch finishes."
                )
            job = JobRecord(id=str(uuid4()), total=1, status="queued")
            session.add(job)
            session.flush()
            image.status = "queued"
            image.error = None
            image.job_id = job.id
        self.wake.set()
        return job

    def delete_image(self, image_id: str) -> None:
        with self.lock, self.database.session.begin() as session:
            image = session.get(ImageRecord, image_id)
            if not image:
                raise HTTPException(404, "This image was not found.")
            if image.status in {"queued", "processing"} and image.job_id:
                job = session.get(JobRecord, image.job_id)
                if job and job.status in {"uploading", "queued", "processing"}:
                    job.processed += 1
                    job.failed += 1
                    job.errors = [*job.errors, f"{image.filename}: removed before indexing completed."]
                    finish_job(job)
            remove_stored_image(image.stored_filename, self.settings)
            session.delete(image)

    def clear(self) -> None:
        with self.lock, self.database.session.begin() as session:
            for job in session.scalars(
                select(JobRecord).where(JobRecord.status.in_(["uploading", "queued", "processing"]))
            ):
                remaining = job.total - job.processed
                job.failed += remaining
                job.processed = job.total
                job.errors = [*job.errors, "The collection was cleared before this batch finished."]
                job.status = "failed"
            for image in session.scalars(select(ImageRecord)):
                remove_stored_image(image.stored_filename, self.settings)
            session.execute(delete(ImageRecord))

    def _run(self) -> None:
        while not self.stopping.is_set():
            job_id = None
            try:
                with self.database.session() as session:
                    job_id = session.scalar(
                        select(JobRecord.id)
                        .where(JobRecord.status == "queued")
                        .order_by(JobRecord.created_at, JobRecord.id)
                        .limit(1)
                    )
                if job_id:
                    self._process_job(job_id)
                    continue
            except Exception:
                logger.exception("Indexing worker encountered a recoverable storage error")
                if job_id:
                    self._requeue_job(job_id)
            self.wake.wait(timeout=0.5)
            self.wake.clear()

    def _requeue_job(self, job_id: str) -> None:
        try:
            with self.lock, self.database.session.begin() as session:
                job = session.get(JobRecord, job_id)
                if job and job.status == "processing":
                    job.status = "queued"
                    for image in session.scalars(
                        select(ImageRecord).where(
                            ImageRecord.job_id == job_id, ImageRecord.status == "processing"
                        )
                    ):
                        image.status = "queued"
        except Exception:
            logger.exception("Could not requeue the interrupted indexing transaction")

    def _claim_image(self, job_id: str) -> ImageRecord | None:
        with self.lock, self.database.session.begin() as session:
            job = session.get(JobRecord, job_id)
            if not job or job.status not in {"queued", "processing"}:
                return None
            image = session.scalar(
                select(ImageRecord)
                .where(ImageRecord.job_id == job_id, ImageRecord.status == "queued")
                .order_by(ImageRecord.uploaded_at, ImageRecord.id)
                .limit(1)
            )
            if not image:
                remaining = max(job.total - job.processed, 0)
                if remaining:
                    job.failed += remaining
                    job.processed += remaining
                    job.errors = [*job.errors, "Some images were removed before indexing completed."]
                finish_job(job)
                return None
            image.status = "processing"
            job.status = "processing"
            return image

    def _detect_image(self, image: ImageRecord) -> tuple[list[dict], str | None]:
        try:
            predictions = self.detector.predict(self.settings.images_dir / image.stored_filename)
            return self._validated_detections(predictions, image.width, image.height), None
        except Exception:
            logger.exception("Object detection failed for image %s", image.id)
            error_message = (
                "Object detection failed. Check the model and device settings, then retry this image."
            )
            try:
                safe_error = self.detector.status().get("error")
                if isinstance(safe_error, str) and safe_error:
                    error_message = safe_error
            except Exception:
                logger.exception("Could not inspect detector failure status")
            return [], error_message

    def _process_job(self, job_id: str) -> None:
        while not self.stopping.is_set():
            image = self._claim_image(job_id)
            if image is None:
                return
            image_id = image.id
            detections, error_message = self._detect_image(image)

            with self.lock, self.database.session.begin() as session:
                image = session.get(ImageRecord, image_id)
                job = session.get(JobRecord, job_id)
                # Deletes and collection clearing cannot resurrect a row after inference.
                if (
                    not image
                    or not job
                    or image.job_id != job_id
                    or job.status not in {"queued", "processing"}
                ):
                    continue
                if error_message:
                    image.status = "failed"
                    image.error = error_message
                    job.failed += 1
                    job.errors = [*job.errors, f"{image.filename}: {error_message}"]
                else:
                    session.execute(delete(DetectionRecord).where(DetectionRecord.image_id == image_id))
                    session.add_all(
                        [DetectionRecord(image_id=image_id, **detection) for detection in detections]
                    )
                    image.model = str(self.detector.model_name)
                    image.status = "completed"
                    image.error = None
                    job.uploaded += 1
                job.processed += 1
                finish_job(job)

    def _validated_detections(self, predictions: Iterable[dict], width: int, height: int) -> list[dict]:
        detections = []
        for prediction in predictions:
            confidence = float(prediction["confidence"])
            coordinates = [float(prediction[key]) for key in ("x1", "y1", "x2", "y2")]
            if not all(math.isfinite(value) for value in [confidence, *coordinates]):
                continue
            if not self.settings.detection_confidence <= confidence <= 1:
                continue
            x1, y1, x2, y2 = coordinates
            x1, x2 = max(0, min(width, x1)), max(0, min(width, x2))
            y1, y2 = max(0, min(height, y1)), max(0, min(height, y2))
            class_id = int(prediction["class_id"])
            class_name = str(prediction["class_name"]).strip().lower()
            if class_id < 0 or not class_name or len(class_name) > 80 or x2 <= x1 or y2 <= y1:
                continue
            detections.append(
                {
                    "class_id": class_id,
                    "class_name": class_name,
                    "confidence": confidence,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                }
            )
        return detections

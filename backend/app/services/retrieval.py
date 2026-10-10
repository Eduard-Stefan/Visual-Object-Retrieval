"""Database-only semantic retrieval; search never calls the detector."""

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session
from datetime import timezone

from ..models import DetectionRecord, ImageRecord
from ..schemas import Category, Detection, Image, ImagePage, SearchRequest, Statistics


def image_payload(
    record: ImageRecord, detections: list[DetectionRecord], categories: list[str] | None = None
) -> Image:
    matching = [item for item in detections if not categories or item.class_name in categories]
    return Image(
        id=record.id,
        filename=record.filename,
        file_hash=record.file_hash,
        width=record.width,
        height=record.height,
        uploaded_at=record.uploaded_at.replace(tzinfo=timezone.utc)
        if record.uploaded_at.tzinfo is None
        else record.uploaded_at,
        status=record.status,
        model=record.model,
        error=record.error,
        file_url=f"/api/images/{record.id}/file",
        thumbnail_url=f"/api/images/{record.id}/thumbnail",
        detections=[Detection.model_validate(item) for item in detections],
        object_count=len(detections),
        matching_count=len(matching),
        score=max((item.confidence for item in matching), default=0.0),
    )


def get_detections(
    session: Session, image_ids: list[str], confidence: float
) -> dict[str, list[DetectionRecord]]:
    grouped: dict[str, list[DetectionRecord]] = {image_id: [] for image_id in image_ids}
    if image_ids:
        records = session.scalars(
            select(DetectionRecord)
            .where(DetectionRecord.image_id.in_(image_ids), DetectionRecord.confidence >= confidence)
            .order_by(DetectionRecord.confidence.desc(), DetectionRecord.id)
        )
        for detection in records:
            grouped[detection.image_id].append(detection)
    return grouped


def search_images(session: Session, query: SearchRequest) -> ImagePage:
    valid = select(
        DetectionRecord.image_id.label("image_id"),
        func.max(DetectionRecord.confidence).label("score"),
        func.count(distinct(DetectionRecord.class_id)).label("category_count"),
    ).where(DetectionRecord.confidence >= query.confidence)

    category_ids: list[int] = []
    if query.categories:
        category_ids = list(
            session.scalars(
                select(DetectionRecord.class_id)
                .distinct()
                .where(DetectionRecord.class_name.in_(query.categories))
            )
        )
        # Unknown categories cannot satisfy AND, and an entirely unknown OR is empty.
        known_names = set(
            session.scalars(
                select(DetectionRecord.class_name)
                .distinct()
                .where(DetectionRecord.class_name.in_(query.categories))
            )
        )
        if (query.mode == "and" and len(known_names) != len(query.categories)) or not category_ids:
            return ImagePage(items=[], total=0, page=query.page, page_size=query.page_size)
        valid = valid.where(DetectionRecord.class_id.in_(category_ids))
    matches = valid.group_by(DetectionRecord.image_id).subquery()
    statement = select(ImageRecord, func.coalesce(matches.c.score, 0.0)).outerjoin(
        matches, ImageRecord.id == matches.c.image_id
    )
    if query.categories:
        statement = statement.where(matches.c.image_id.is_not(None), ImageRecord.status == "completed")
        if query.mode == "and":
            statement = statement.where(matches.c.category_count == len(category_ids))
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    score = func.coalesce(matches.c.score, 0.0)
    order = {
        "confidence_desc": (score.desc(), ImageRecord.uploaded_at.desc(), ImageRecord.id.asc()),
        "confidence_asc": (score.asc(), ImageRecord.uploaded_at.desc(), ImageRecord.id.asc()),
        "filename": (func.lower(ImageRecord.filename).asc(), ImageRecord.id.asc()),
        "newest": (ImageRecord.uploaded_at.desc(), ImageRecord.id.asc()),
        "oldest": (ImageRecord.uploaded_at.asc(), ImageRecord.id.asc()),
    }[query.sort]
    records = session.execute(
        statement.order_by(*order).offset((query.page - 1) * query.page_size).limit(query.page_size)
    ).all()
    detections = get_detections(session, [record.id for record, _ in records], query.confidence)
    return ImagePage(
        items=[image_payload(record, detections[record.id], query.categories) for record, _ in records],
        total=total,
        page=query.page,
        page_size=query.page_size,
    )


def categories(session: Session, confidence: float) -> list[Category]:
    rows = session.execute(
        select(
            DetectionRecord.class_id,
            DetectionRecord.class_name,
            func.count(distinct(DetectionRecord.image_id)),
            func.count(DetectionRecord.id),
        )
        .where(DetectionRecord.confidence >= confidence)
        .group_by(DetectionRecord.class_id, DetectionRecord.class_name)
        .order_by(DetectionRecord.class_name)
    )
    return [
        Category(class_id=row[0], class_name=row[1], image_count=row[2], object_count=row[3]) for row in rows
    ]


def statistics(session: Session, confidence: float) -> Statistics:
    available = categories(session, confidence)
    distribution = sorted(
        [{"class_name": category.class_name, "count": category.object_count} for category in available],
        key=lambda entry: (-entry["count"], entry["class_name"]),
    )
    return Statistics(
        total_images=session.scalar(select(func.count()).select_from(ImageRecord)) or 0,
        total_objects=sum(category.object_count for category in available),
        total_categories=len(available),
        distribution=distribution,
    )

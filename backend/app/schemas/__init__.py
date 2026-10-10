"""Typed API payloads and validation."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


SortOrder = Literal["confidence_desc", "confidence_asc", "filename", "newest", "oldest"]


class APIError(BaseModel):
    detail: str


class Detection(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_id: int
    class_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class Image(BaseModel):
    id: str
    filename: str
    file_hash: str
    width: int
    height: int
    uploaded_at: datetime
    status: str
    model: str | None
    error: str | None = None
    file_url: str
    thumbnail_url: str
    detections: list[Detection]
    object_count: int
    matching_count: int
    score: float


class ImagePage(BaseModel):
    items: list[Image]
    total: int
    page: int
    page_size: int


class SearchRequest(BaseModel):
    categories: list[str] = Field(default_factory=list, max_length=80)
    mode: Literal["and", "or"] = "and"
    confidence: float = Field(default=0.5, ge=0, le=1)
    sort: SortOrder = "confidence_desc"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=24, ge=1, le=100)

    @field_validator("categories")
    @classmethod
    def canonical_categories(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or len(value) > 80 for value in values):
            raise ValueError("Object categories must contain 1 to 80 characters.")
        return list(dict.fromkeys(value.strip().lower() for value in values))


class Category(BaseModel):
    class_id: int
    class_name: str
    image_count: int
    object_count: int


class DistributionEntry(BaseModel):
    class_name: str
    count: int


class Statistics(BaseModel):
    total_images: int
    total_objects: int
    total_categories: int
    distribution: list[DistributionEntry]


class UploadAccepted(BaseModel):
    job_id: str
    total: int


class Job(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: Literal["queued", "processing", "completed", "failed"]
    total: int
    processed: int
    uploaded: int
    duplicates: int
    failed: int
    errors: list[str]

"""Environment-based configuration with practical local defaults."""

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VOR_", env_file=REPOSITORY_ROOT / ".env", extra="ignore")

    data_dir: Path = REPOSITORY_ROOT / "data"
    database_url: str | None = None
    model: str = "yolo11m.pt"
    fallback_model: str = "yolo11s.pt"
    device: str = "auto"
    image_size: int = Field(default=640, ge=160, le=2048)
    detection_confidence: float = Field(default=0.15, gt=0, le=1)
    max_file_mb: int = Field(default=20, ge=1, le=200)
    max_image_pixels: int = Field(default=40_000_000, ge=1)
    max_upload_files: int = Field(default=50, ge=1, le=250)
    max_upload_body_mb: int = Field(default=256, ge=1, le=2048)
    max_pending_images: int = Field(default=250, ge=1)
    thumbnail_size: int = Field(default=640, ge=64, le=2048)
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    frontend_dist: Path = REPOSITORY_ROOT / "frontend" / "dist"

    @field_validator("data_dir", "frontend_dist")
    @classmethod
    def absolute_path(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    @property
    def images_dir(self) -> Path:
        return self.data_dir / "images"

    @property
    def thumbnails_dir(self) -> Path:
        return self.data_dir / "thumbnails"

    @property
    def sqlite_url(self) -> str:
        return self.database_url or f"sqlite:///{(self.data_dir / 'index.sqlite3').as_posix()}"

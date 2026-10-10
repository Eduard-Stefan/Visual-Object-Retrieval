"""Validate uploads and store orientation-correct images with bounded dimensions."""

from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import re
import unicodedata
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from ..core.config import Settings


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}
GENERATED_FILENAME = re.compile(r"^[0-9a-f-]{36}\.jpg$")


@dataclass
class PreparedImage:
    filename: str
    file_hash: str
    image: Image.Image


def safe_filename(filename: str | None) -> str:
    name = (filename or "image.jpg").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(character for character in name if not unicodedata.category(character).startswith("C"))
    name = name.strip(" .")
    if not name:
        name = "image.jpg"
    if len(name) > 240:
        name = name[: 240 - len(Path(name).suffix)] + Path(name).suffix
    return name


def prepare_image(filename: str | None, payload: bytes, settings: Settings) -> PreparedImage:
    name = safe_filename(filename)
    if Path(name).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError("Only JPG, JPEG, PNG, and WEBP images are supported.")
    if not payload:
        raise ValueError("The image file is empty.")
    if len(payload) > settings.max_file_mb * 1024 * 1024:
        raise ValueError(f"The image exceeds the {settings.max_file_mb} MB file limit.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as source:
                if source.format not in SUPPORTED_FORMATS:
                    raise ValueError("The file content is not a supported JPG, PNG, or WEBP image.")
                if source.width * source.height > settings.max_image_pixels:
                    raise ValueError(f"The image exceeds the {settings.max_image_pixels:,} pixel limit.")
                source.load()
                oriented = ImageOps.exif_transpose(source)
                if "A" in oriented.getbands() or "transparency" in oriented.info:
                    rgba = oriented.convert("RGBA")
                    normalized = Image.new("RGB", rgba.size, "white")
                    normalized.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    normalized = oriented.convert("RGB")
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError("The image is corrupted, unsafe, or cannot be decoded.") from error
    return PreparedImage(name, sha256(payload).hexdigest(), normalized)


def store_image(prepared: PreparedImage, stored_filename: str, settings: Settings) -> None:
    destination = settings.images_dir / stored_filename
    thumbnail_path = settings.thumbnails_dir / stored_filename
    temporary_image = destination.with_suffix(".tmp")
    temporary_thumbnail = thumbnail_path.with_suffix(".tmp")
    try:
        prepared.image.save(temporary_image, format="JPEG", quality=92, optimize=True)
        thumbnail = prepared.image.copy()
        thumbnail.thumbnail((settings.thumbnail_size, settings.thumbnail_size), Image.Resampling.LANCZOS)
        thumbnail.save(temporary_thumbnail, format="JPEG", quality=85, optimize=True)
        temporary_image.replace(destination)
        temporary_thumbnail.replace(thumbnail_path)
    except Exception:
        for path in (temporary_image, temporary_thumbnail, destination, thumbnail_path):
            path.unlink(missing_ok=True)
        raise


def remove_stored_image(stored_filename: str, settings: Settings) -> None:
    # Database values must never become an arbitrary filesystem access primitive.
    if not GENERATED_FILENAME.fullmatch(stored_filename):
        raise ValueError("Invalid stored image identifier.")
    for directory in (settings.images_dir, settings.thumbnails_dir):
        target = directory / stored_filename
        if not target.resolve().is_relative_to(directory.resolve()):
            raise ValueError("Invalid image storage path.")
        target.unlink(missing_ok=True)

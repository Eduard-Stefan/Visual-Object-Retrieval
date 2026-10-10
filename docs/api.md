# Local API and storage behavior

The FastAPI server exposes the application API at `http://127.0.0.1:8000/api`.
Interactive endpoint documentation is available at `http://127.0.0.1:8000/docs`.
The Vite development server forwards `/api` requests to this backend. A production
frontend build in `frontend/dist` is also served directly by FastAPI.

Run **one Uvicorn process**, using the commands in the README. One persistent
worker processes inference sequentially, keeping batch size and simultaneous GPU
work bounded. Multiple application workers sharing one database are unsupported.

## Endpoints

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Returns `{ "status": "ok" }` when the API is running. |
| GET | `/api/system` | Reports model, device, FP16 status, model readiness, safe errors, warnings, hardware, and upload limits. |
| POST | `/api/images/upload` | Accepts multipart `files` fields; returns `202` with `{ "job_id": "...", "total": 3 }`. |
| GET | `/api/jobs/{job_id}` | Returns durable batch progress and processing errors. |
| GET | `/api/images` | Lists paginated collection metadata. |
| GET | `/api/images/{image_id}` | Returns one image and its threshold-filtered detections. |
| GET | `/api/images/{image_id}/detections` | Returns threshold-filtered detection metadata. |
| GET | `/api/images/{image_id}/file` | Serves the stored, normalized JPEG securely. |
| GET | `/api/images/{image_id}/thumbnail` | Serves the image thumbnail as JPEG. |
| POST | `/api/images/{image_id}/retry` | Requeues a failed image; returns `202` with a new job ID. |
| DELETE | `/api/images/{image_id}` | Removes the image, thumbnail, and associated detections; returns `204`. |
| DELETE | `/api/images` | Clears the collection and cancels unfinished indexing; returns `204`. |
| GET | `/api/search/categories` | Returns available categories at the active confidence threshold. |
| POST | `/api/search` | Retrieves matching images from indexed SQLite metadata. |
| GET | `/api/statistics` | Returns actual collection counts and object distribution at the threshold. |

`GET /api/images` accepts `confidence`, `sort`, `page`, and `page_size`.
The default page is 1, the default size is 24, and the maximum size is 100.
Image detail, detections, categories, and statistics also accept `confidence`.
The default confidence is `0.5`; valid values range from `0` to `1`, inclusive.

## Uploads and progress

Supply one multipart field named `files` for each image. JPG, JPEG, PNG, and WEBP
are accepted. Validation checks both the extension and decoded content, rejects
unsafe dimensions and corrupted images, and sanitizes the displayed filename.
EXIF orientation is applied before dimensions and bounding boxes are calculated.
Files are converted to RGB JPEG; transparent pixels are composited on white.
The original filename is metadata, so a PNG or WEBP upload is still served as
`image/jpeg`. A download client should use a `.jpg` extension for these bytes.

The original upload bytes are hashed using SHA-256. A database uniqueness
constraint and synchronized staging prevent duplicate image rows, including
simultaneous uploads of the same content. Duplicate files count as processed;
they do not rerun inference. Reuploading a failed image is still a duplicate;
use the retry endpoint to run its indexing again.

An accepted batch returns before inference finishes. Poll its job endpoint:

```json
{
  "id": "a-generated-job-id",
  "status": "processing",
  "total": 3,
  "processed": 2,
  "uploaded": 1,
  "duplicates": 1,
  "failed": 0,
  "errors": []
}
```

Public job statuses are `queued`, `processing`, `completed`, and `failed`.
`uploaded` means successfully indexed images. `processed` counts successful,
duplicate, invalid, failed, and canceled images. A partially successful batch
finishes as `completed` and retains its failure count and error messages. A
batch with no successful or duplicate images finishes as `failed`. If every
file fails initial validation, the upload endpoint instead returns `400` with
the validation messages.

Jobs and counters persist in SQLite. On restart, queued images resume and an
interrupted inference operation is retried. Interrupted files that had not
finished storage are reported as failures and must be uploaded again. Temporary
files and orphaned generated images from an interrupted write are cleaned up.
Deleting an image during inference cancels its indexing; the completed operation
cannot recreate the deleted record. Clearing the collection has the same
protection for the entire batch.

## Retrieval and ranking

Example request to `POST /api/search`:

```json
{
  "categories": ["person", "bicycle"],
  "mode": "and",
  "confidence": 0.5,
  "sort": "confidence_desc",
  "page": 1,
  "page_size": 24
}
```

Category names are trimmed, converted to lowercase, deduplicated, and resolved
to their indexed class IDs. `and` requires every selected category in the same
image. `or` requires at least one. An empty category list returns the collection.
An unknown category cannot satisfy AND; known categories still work in OR.

Search, category lists, annotations, and statistics apply `confidence >=` the
requested threshold to persisted detections. These operations never call YOLO.
Detections below the configured detection-time floor were never indexed and
cannot be recovered by lowering the search threshold.

Supported sorting values are `confidence_desc`, `confidence_asc`, `filename`,
`newest`, and `oldest`. Confidence ranking uses the **highest confidence among
matching detections in each image**. With no category filter, it uses all valid
detections. Images with no valid detections have score `0`. Confidence ties use
upload time, then image ID; other sorting options also use image ID as a stable
tie-breaker. Filename sorting is case-insensitive.

Both collection and search responses have this shape:

```json
{ "items": [], "total": 0, "page": 1, "page_size": 24 }
```

Each image includes `id`, `filename`, `file_hash`, `width`, `height`,
`uploaded_at` (UTC), `status`, `model`, `error`, `file_url`, `thumbnail_url`,
`detections`, `object_count`, `matching_count`, and `score`. Image statuses are
`queued`, `processing`, `completed`, and `failed`; `model` is nullable before a
successful inference. URLs are relative to the application origin. Each
detection includes `id`, `class_id`, `class_name`, `confidence`, `x1`, `y1`, `x2`,
and `y2`; coordinates refer to the orientation-correct normalized image.

`object_count` counts all returned detections. `matching_count` counts returned
detections belonging to the search categories, or all returned detections when
no categories are selected. `total_images` in statistics counts every stored
image, including unfinished and failed images. Object counts include only
successfully persisted detections that meet the threshold.

## Configuration

Settings use the `VOR_` environment prefix and can be placed in the repository
`.env` file. Configuration is defined in `backend/app/core/config.py`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOR_DATA_DIR` | Repository `data` directory | Image, thumbnail, database, and model storage. |
| `VOR_DATABASE_URL` | SQLite database in `VOR_DATA_DIR` | Optional SQLite URL override. |
| `VOR_MODEL` | `yolo11m.pt` | Preferred pretrained detection model. |
| `VOR_FALLBACK_MODEL` | `yolo11s.pt` | Smaller model for controlled recovery. |
| `VOR_DEVICE` | `auto` | Automatic device selection or explicit compatible device. |
| `VOR_IMAGE_SIZE` | `640` | Inference resize target. |
| `VOR_DETECTION_CONFIDENCE` | `0.15` | Minimum confidence stored during indexing. |
| `VOR_MAX_FILE_MB` | `20` | Maximum size of each source image. |
| `VOR_MAX_UPLOAD_FILES` | `50` | Maximum images in a single batch. |
| `VOR_MAX_UPLOAD_BODY_MB` | `256` | Aggregate request limit, including multipart overhead. |
| `VOR_MAX_IMAGE_PIXELS` | `40000000` | Maximum decoded source-image pixels. |
| `VOR_MAX_PENDING_IMAGES` | `250` | Maximum reserved, queued, or active images. |
| `VOR_THUMBNAIL_SIZE` | `640` | Maximum thumbnail width or height. |
| `VOR_CORS_ORIGINS` | Localhost and loopback port 5173 | JSON array of allowed development origins. |
| `VOR_FRONTEND_DIST` | Repository `frontend/dist` | Optional built frontend directory. |

The aggregate upload cap is enforced before multipart staging, including
chunked requests without a `Content-Length` header. The parser closes any
partially spooled files when a streamed request crosses this cap. A batch may
contain up to 50 images but must also fit within the aggregate size limit.

## Errors

Errors use a human-readable JSON string: `{ "detail": "Explanation and next step." }`.

| Status | Meaning |
| --- | --- |
| `400` | No valid images, malformed content, or invalid initial image data. |
| `404` | Unknown image, job, or file. |
| `409` | Invalid retry state or a collection cleared during upload staging. |
| `413` | Too many files or an oversized aggregate upload request. |
| `422` | Invalid request fields, confidence, pagination, mode, or sort. |
| `429` | Processing queue is full; wait for work to finish. |
| `500` | An unexpected storage or API failure; inspect the backend log. |

Model download and inference failures are reported through safe job/image errors
and `/api/system`. Previously indexed images remain searchable. Correct the
model or device configuration and retry failed images; changing configuration
requires restarting the backend.

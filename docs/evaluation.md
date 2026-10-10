# Evaluating image retrieval

This application retrieves **images**, so the unit of evaluation is an image,
not an individual bounding box. A result is relevant if the original image
visibly contains the queried category, or all queried categories in AND mode.
In OR mode, at least one queried category must be present. Two objects need not
overlap. Multiple detections in one image still count as one retrieved image.

Ground truth must come from people inspecting the original images. Do not copy
YOLO detections into the label file: doing so measures agreement with the index
and hides missed objects. No real benchmark scores are included in this
repository because no independently labeled evaluation collection is bundled.

## Prepare independent ground truth

1. Prepare 30–50 images as described in [Demo dataset](demo-dataset.md).
2. Start the backend and upload the complete collection. Wait until every image
   has completed processing. Resolve failed images before evaluating.
3. From the repository root, export a labeling template:

   ```powershell
   python scripts/prepare_demo.py --output data/evaluation/labels.json
   ```

4. Inspect each original image and replace its `"categories": null` with the
   visible supported COCO object names. Use an empty array `[]` only after
   inspecting the image and finding no supported objects. Use canonical names
   such as `person`, `car`, `bicycle`, `dog`, and `traffic light`.
5. Save the reviewed JSON. Keep the original image filenames and file hashes.
   The exporter refuses to overwrite an existing file to preserve your work.

The JSON schema is:

```json
{
  "schema_version": 1,
  "description": "A manually reviewed demo collection",
  "images": [
    {
      "filename": "cycling.jpg",
      "file_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "categories": ["person", "bicycle"]
    },
    {
      "filename": "landscape.jpg",
      "categories": []
    }
  ]
}
```

This snippet illustrates the schema only. Its filenames and repeated-character
hash are placeholders, not supplied evaluation data or measured results.
`file_hash` is an optional SHA-256 of the originally uploaded file; the template
includes actual hashes returned by the API. Preserve them so replacement images
cannot silently reuse old labels. Filenames are matched exactly. Categories
are trimmed and converted to lowercase.

Every indexed image must appear once in the labels, and every labeled image must
exist in the index. Duplicate original filenames are rejected because relevance
would be ambiguous; assign unique source filenames before uploading. `null`
labels are rejected. These checks prevent unknown images from being silently
treated as negatives, or missing uploads from being counted as detector errors.

Use a written labeling rule before examining results. For example, count an
object when a reviewer can identify its supported category, even when it is
partially occluded; agree beforehand whether reflections, screens, photographs,
and very small objects count. Record borderline cases and, if possible, have a
second reviewer check the labels. Keep the same rule for all images and queries.

## Run the evaluator

The evaluation scripts use only Python's standard library. Run these commands
from the repository root while the backend is running and the collection is idle:

```powershell
python scripts/evaluate.py --labels data/evaluation/labels.json --categories car --confidence 0.50 --output data/evaluation/car-050.json
python scripts/evaluate.py --labels data/evaluation/labels.json --categories person bicycle --mode and --confidence 0.50 --output data/evaluation/person-bicycle-and.json
python scripts/evaluate.py --labels data/evaluation/labels.json --categories person dog --mode or --confidence 0.50 --output data/evaluation/person-dog-or.json
python scripts/evaluate.py --labels data/evaluation/labels.json --categories "traffic light" --api-url http://127.0.0.1:8000
```

`--categories` can also be repeated, for example `--categories person
--categories bicycle`. The default mode is AND, and the default confidence is
0.5. Confidence must be between 0 and 1. The API URL is the backend base URL,
without `/api` appended. The script prints JSON and optionally saves the same
report with `--output`. A validation or API error exits with code 1.

The evaluator reads the complete collection and all pages of search results
through `GET /api/images` and `POST /api/search`. It queries the persistent
detection index; it does not upload images, edit the collection, or run YOLO.
It checks collection identity again afterward and rejects observable collection
changes. Avoid uploads, deletions, and reindexing during a run.

## Interpret the output

Let `R` be the manually relevant images and `S` the returned search images:

- **True positives (TP):** `R ∩ S`, correctly retrieved images.
- **False positives (FP):** `S − R`, returned images that are not relevant.
- **False negatives (FN):** `R − S`, relevant images missed by retrieval.
- **Precision:** `TP / (TP + FP)`, the fraction of retrieved images that are relevant.
- **Recall:** `TP / (TP + FN)`, the fraction of relevant images retrieved.
- **F1:** `2TP / (2TP + FP + FN)`, a combined precision and recall measure.

The JSON contains the counts and the filenames in all three groups so a
presenter can inspect false positives and missed images directly. It also
records the query, threshold, collection size, model identifiers, number of
hash-verified labels, and UTC timestamp. A confidence change filters the same
stored detections; it does not change the manual relevance labels.

When no images are retrieved, precision is undefined and reported as `null`.
When no images are relevant, recall is undefined and reported as `null`.
F1 is `null` when neither relevant nor retrieved images exist; otherwise the
formula above applies. Do not replace undefined values with 100% in a report.

Evaluate several preselected queries and thresholds, including single objects,
AND queries, OR queries, and categories that are absent. Record the number of
relevant images for each query. A high score on a tiny or heavily selected
collection is not evidence of general object-detection accuracy. If tuning a
threshold, use a separate development collection and report scores on a held-out
evaluation collection using the chosen threshold.

## Limits of this evaluation

This is set-based semantic image retrieval evaluation, not COCO detection mAP,
bounding-box localization evaluation, or a ranking benchmark. Confidence sorting
does not change set precision and recall when all pages are included. Missing
detections, incorrect category predictions, and the detection-time storage floor
can all affect retrieval. A search threshold below the indexing confidence floor
cannot restore detections that were never stored. Reindex with a changed
inference configuration before comparing models or storage floors, and keep
their reports separate.

The unit tests use explicit artificial filenames and categories to validate
formulae and error handling. Those fixtures are software tests and are never
presented as measured YOLO performance.

# Preparing a 30–50-image demonstration

Use your own photographs, images you have permission to use, or images whose
licenses allow your intended demonstration and redistribution. No photo dataset
is bundled with this repository. Uploads, local evaluation labels, and generated
reports belong in the ignored `data/` directory rather than in Git.

Build a varied collection that makes retrieval behavior easy to explain:

- Street scenes with people, cars, bicycles, buses, or trucks.
- People with dogs or bicycles for multi-object AND queries.
- Indoor scenes with chairs, laptops, bottles, or backpacks.
- Images with one dominant category and images containing several categories.
- A few images containing none of the categories used in your example queries.
- A few difficult but recognizable objects: partial occlusion, small objects,
  less favorable lighting, or objects toward the edge of the frame.

Choose 30–50 distinct photographs. Keep the source filenames unique across the
collection, for example `street-01.jpg` and `indoor-01.jpg`. JPG, JPEG, PNG, and
WEBP are supported. Keep each file inside the configured upload limits. Do not
duplicate one photograph with different crops simply to increase the sample
count; closely related images can make a demo appear more varied than it is.

Maintain a local provenance record next to the images. For each image, record
its unique filename, source URL or photographer, license or permission, any
required attribution, modifications, and the date obtained. A simple CSV can
use the columns:

```text
filename,source,creator,license,attribution,modifications,obtained_date
```

Check the license attached to each individual image and satisfy its attribution
terms. If the license does not permit redistribution, keep the image local and
do not include it in a public repository or downloadable sample archive.

## Suggested presentation sequence

1. Start the backend and frontend using the README commands.
2. Upload several files together. Show the per-image indexing progress and the
   resulting collection statistics.
3. Open an image to explain a detected category, confidence, and bounding box.
4. Search for a category present in the collection, such as `car`.
5. Search for `person` AND `bicycle`, then switch to OR and compare the images.
6. Increase the confidence threshold and show the category list, annotations,
   counts, and results updating from stored metadata.
7. Sort the results, inspect a full-size image, and refresh to demonstrate
   persistence. Delete a disposable test upload to demonstrate collection management.
8. Present the actual precision, recall, false positives, and missed images from
   [the independent manual evaluation](evaluation.md).

Do the quantitative evaluation before deleting images or changing the
collection. Keep its reviewed labels and reports together with the source
images. If you rebuild the collection with renamed or edited files, export and
review an appropriate new label file.

These instructions produce a genuine demonstration collection. Generated
geometric shapes, fake detections, or a list of predetermined search hits are
not substitutes for real YOLO indexing or independently labeled evaluation.

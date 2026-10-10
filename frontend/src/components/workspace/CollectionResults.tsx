import { ArrowLeft, ArrowRight, Eye, ScanLine } from 'lucide-react';
import type { CollectionController } from '../../hooks/useCollection';
import { errorMessage, label, number, percent } from '../../lib/format';
import { ImageCard } from '../gallery/ImageCard';
import { EmptyState, ErrorNotice, GallerySkeleton } from '../ui/Feedback';

function resultsTitle(model: CollectionController) {
  if (model.currentSearch) return 'Search Results';
  return model.view === 'collection' ? 'All Images' : 'Explore Your Collection';
}

function resultsDescription(model: CollectionController) {
  const { currentSearch, confidence } = model;
  if (!currentSearch) return 'Your visual library, ready to explore.';
  if (currentSearch.categories.length === 0)
    return 'Choose another object or lower the threshold to start a new search.';
  const separator = currentSearch.mode === 'and' ? ' + ' : ' or ';
  return `${currentSearch.categories.map(label).join(separator)} · ${percent(confidence)} minimum confidence · ranked by matching detections`;
}

function GalleryResults({ model }: Readonly<{ model: CollectionController }>) {
  const {
    images,
    page,
    annotated,
    confidence,
    showOthers,
    currentSearch,
    setDetailImage,
    setPage,
  } = model;
  if (!images.data) return null;
  const pageCount = Math.max(1, Math.ceil(images.data.total / 24));
  const matchingCategories = currentSearch?.categories ?? [];
  return (
    <>
      <div
        className={`gallery-grid ${images.isFetching ? 'refreshing' : ''}`}
        aria-busy={images.isFetching}
      >
        {images.data.items.map((image) => (
          <ImageCard
            key={image.id}
            image={image}
            confidence={confidence}
            annotated={annotated}
            selected={matchingCategories}
            showOthers={showOthers}
            onOpen={() => setDetailImage(image)}
          />
        ))}
      </div>
      <div className="gallery-footer">
        <span>
          Showing {number((page - 1) * 24 + 1)}–{number(Math.min(page * 24, images.data.total))} of{' '}
          {number(images.data.total)} images
        </span>
        {pageCount > 1 && (
          <div className="pagination">
            <button
              className="button button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ArrowLeft size={14} />
              Previous
            </button>
            <span>
              Page {page} of {pageCount}
            </span>
            <button
              className="button button-secondary"
              disabled={page >= pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        <span>
          <span className="status-dot online" /> Persistent local index
        </span>
      </div>
    </>
  );
}

function ResultsContent({ model }: Readonly<{ model: CollectionController }>) {
  const { images, system, processing, currentSearch, openUpload } = model;
  if (images.isLoading) return <GallerySkeleton />;
  if (images.isError)
    return system.isError ? null : (
      <ErrorNotice message={errorMessage(images.error)} onRetry={() => void images.refetch()} />
    );
  if (images.data?.items.length) return <GalleryResults model={model} />;
  if (processing)
    return (
      <EmptyState type="objects" title="Your visual index is taking shape">
        Images will appear here as soon as they are processed. Progress is shown above.
      </EmptyState>
    );
  if (currentSearch)
    return (
      <EmptyState type="search" title="No matching images">
        Try another object category, use OR to broaden your search, or lower the confidence
        threshold.
      </EmptyState>
    );
  return (
    <EmptyState type="collection" title="Your next discovery starts here" onUpload={openUpload}>
      Upload a few images. YOLO will identify their objects and build your searchable collection
      automatically.
    </EmptyState>
  );
}

export function CollectionResults({ model }: Readonly<{ model: CollectionController }>) {
  const { images, annotated, showOthers, currentSearch, setAnnotated, setShowOthers } = model;
  const matchingCategories = currentSearch?.categories ?? [];
  return (
    <section className="results-section" aria-label="Image results">
      <div className="results-heading">
        <div>
          <h2>
            {resultsTitle(model)}
            {images.data && <span className="count-badge">{number(images.data.total)}</span>}
          </h2>
          <p>{resultsDescription(model)}</p>
        </div>
        <div className="gallery-controls">
          <div className="segmented">
            <button
              className={annotated ? 'active' : ''}
              onClick={() => setAnnotated(true)}
              aria-pressed={annotated}
            >
              <ScanLine size={14} />
              Annotated
            </button>
            <button
              className={!annotated ? 'active' : ''}
              onClick={() => setAnnotated(false)}
              aria-pressed={!annotated}
            >
              <Eye size={14} />
              Original
            </button>
          </div>
          {matchingCategories.length > 0 && annotated && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={showOthers}
                onChange={(event) => setShowOthers(event.target.checked)}
              />{' '}
              Show other objects
            </label>
          )}
        </div>
      </div>
      <ResultsContent model={model} />
    </section>
  );
}

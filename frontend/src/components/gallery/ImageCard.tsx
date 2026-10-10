import { ArrowUpRight, ScanLine } from 'lucide-react';
import type { IndexedImage } from '../../types';
import { categoryColor, label, percent } from '../../lib/format';
import { AnnotatedImage } from './AnnotatedImage';

export function ImageCard({
  image,
  confidence,
  annotated,
  selected,
  showOthers,
  onOpen,
}: {
  image: IndexedImage;
  confidence: number;
  annotated: boolean;
  selected: string[];
  showOthers: boolean;
  onOpen: () => void;
}) {
  const detections = image.detections.filter((detection) => detection.confidence >= confidence);
  const categories = [...new Set(detections.map((detection) => detection.class_name))];
  const matching = detections.filter(
    (detection) => !selected.length || selected.includes(detection.class_name),
  );
  const highest = matching.length
    ? Math.max(...matching.map((detection) => detection.confidence))
    : null;
  return (
    <article className="image-card">
      <button
        className="image-card-preview"
        onClick={onOpen}
        aria-label={`View Details for ${image.filename}`}
      >
        <AnnotatedImage
          image={image}
          confidence={confidence}
          annotated={annotated}
          selected={selected}
          showOthers={showOthers}
        />
        {highest !== null && (
          <span className="confidence-badge">
            <span />
            {percent(highest)} confidence
          </span>
        )}
        {image.status !== 'completed' && (
          <span className={`image-status-badge ${image.status === 'failed' ? 'failed' : ''}`}>
            {image.status === 'failed'
              ? 'Indexing failed · View to retry'
              : 'Waiting for detection…'}
          </span>
        )}
        <span className="image-hover-action">
          <ScanLine size={20} />
          View Details
        </span>
      </button>
      <div className="image-card-body">
        <div className="image-card-title">
          <h3 title={image.filename}>{image.filename}</h3>
          <button className="icon-button" onClick={onOpen} aria-label={`Inspect ${image.filename}`}>
            <ArrowUpRight size={17} />
          </button>
        </div>
        <p className="image-card-meta">
          <ScanLine size={13} />
          {selected.length
            ? `${matching.length} matching object${matching.length !== 1 ? 's' : ''}`
            : `${detections.length} detected object${detections.length !== 1 ? 's' : ''}`}
          <span>·</span>
          {image.width} × {image.height}
        </p>
        <div className="card-categories">
          {categories.slice(0, 3).map((name) => (
            <span className={`object-tag ${selected.includes(name) ? 'matched' : ''}`} key={name}>
              <i style={{ backgroundColor: categoryColor(name) }} />
              {label(name)}
            </span>
          ))}
          {categories.length > 3 && (
            <span className="more-categories">+{categories.length - 3}</span>
          )}
          {!categories.length && <span className="no-objects">No objects at this threshold</span>}
        </div>
      </div>
    </article>
  );
}

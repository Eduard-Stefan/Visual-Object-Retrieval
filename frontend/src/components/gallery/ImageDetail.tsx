import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Download, Image, RotateCcw, ScanLine, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { IndexedImage } from '../../types';
import { api } from '../../services/api';
import { categoryColor, errorMessage, label, percent } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { ErrorNotice } from '../ui/Feedback';
import { AnnotatedImage } from './AnnotatedImage';

export function ImageDetail({
  image: initial,
  confidence,
  selected,
  onClose,
  onDelete,
  onRetry,
  retrying = false,
  retryError,
}: Readonly<{
  image: IndexedImage;
  confidence: number;
  selected: string[];
  onClose: () => void;
  onDelete: (image: IndexedImage) => void;
  onRetry?: (image: IndexedImage) => void;
  retrying?: boolean;
  retryError?: string;
}>) {
  const [annotated, setAnnotated] = useState(true);
  const [showOthers, setShowOthers] = useState(true);
  const detail = useQuery({
    queryKey: ['image', initial.id, confidence],
    queryFn: () => api.image(initial.id, confidence),
    initialData: initial,
  });
  const image = detail.data;
  const detections = image.detections.filter((detection) => detection.confidence >= confidence);
  const emptyMessages: Record<string, string> = {
    completed: 'No objects meet this confidence threshold.',
    failed: 'Retry indexing to detect objects in this image.',
  };
  const emptyMessage = emptyMessages[image.status] ?? 'This image is waiting to be indexed.';
  return (
    <Modal
      title={image.filename}
      description={`${image.width} × ${image.height} pixels · ${image.model ?? label(image.status)}`}
      onClose={onClose}
      wide
    >
      <div className="detail-toolbar">
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
            <Image size={14} />
            Original
          </button>
        </div>
        {selected.length > 0 && annotated && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showOthers}
              onChange={(event) => setShowOthers(event.target.checked)}
            />{' '}
            Show other detections
          </label>
        )}
        <a
          href={image.file_url}
          download={`${image.filename.replace(/\.[^.]+$/, '')}.jpg`}
          className="text-button"
        >
          <Download size={15} />
          Download image
        </a>
      </div>
      {detail.isError && (
        <ErrorNotice message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
      )}
      {retryError && <ErrorNotice message={retryError} />}
      {image.status === 'failed' && (
        <div className="detail-failure">
          <ErrorNotice message={image.error ?? 'Object detection failed for this image.'} />
          {onRetry && (
            <button
              className="button button-secondary"
              onClick={() => onRetry(image)}
              disabled={retrying}
            >
              <RotateCcw size={15} />
              {retrying ? 'Retrying…' : 'Retry Indexing'}
            </button>
          )}
        </div>
      )}
      <div className="detail-layout">
        <div className="detail-image">
          <AnnotatedImage
            image={image}
            confidence={confidence}
            annotated={annotated}
            selected={selected}
            showOthers={showOthers}
            original
          />
        </div>
        <aside className="detection-sidebar">
          <div className="detection-heading">
            <h3>Detected Objects</h3>
            <span>{detections.length}</span>
          </div>
          <p className="detection-caption">Confidence ≥ {percent(confidence)}</p>
          <div className="detection-list">
            {detections.map((detection) => (
              <div className="detection-row" key={detection.id}>
                <i style={{ backgroundColor: categoryColor(detection.class_name) }} />
                <span>
                  {label(detection.class_name)}
                  {selected.includes(detection.class_name) && <small>Match</small>}
                </span>
                <strong>{percent(detection.confidence)}</strong>
              </div>
            ))}
            {!detections.length && <p className="muted">{emptyMessage}</p>}
          </div>
          <div className="detail-metadata">
            <CalendarDays size={15} />
            <span>
              Uploaded{' '}
              {new Date(image.uploaded_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
        </aside>
      </div>
      <div className="modal-footer detail-footer">
        <p>Bounding boxes show stored YOLO detections.</p>
        <button className="button button-danger-outline" onClick={() => onDelete(image)}>
          <Trash2 size={15} />
          Delete Image
        </button>
      </div>
    </Modal>
  );
}

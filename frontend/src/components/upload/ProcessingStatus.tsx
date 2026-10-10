import { CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { ProcessingJob } from '../../types';

export function ProcessingStatus({
  job,
  onDismiss,
}: {
  job: ProcessingJob;
  onDismiss: () => void;
}) {
  const done = job.status === 'completed' || job.status === 'failed';
  const failed = job.status === 'failed';
  const progress = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  return (
    <div
      className={`processing-status ${done ? 'finished' : ''} ${failed ? 'failed' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="processing-icon">
        {failed ? (
          <CircleAlert size={22} />
        ) : done ? (
          <CheckCircle2 size={22} />
        ) : (
          <LoaderCircle size={22} className="spin" />
        )}
      </div>
      <div className="processing-content">
        <strong>
          {failed
            ? 'Processing could not be completed'
            : done
              ? 'Your collection is up to date'
              : job.status === 'queued'
                ? 'Your images are queued for indexing'
                : 'Finding objects in your images…'}
        </strong>
        <p>
          {done
            ? `${job.uploaded} indexed · ${job.duplicates} duplicate${job.duplicates !== 1 ? 's' : ''} skipped · ${job.failed} failed`
            : `${job.processed} of ${job.total} images processed. You can keep exploring while YOLO works.`}
        </p>
        {!done && (
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Image processing progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
        {job.errors.length > 0 && (
          <details className="processing-errors">
            <summary>
              View {job.errors.length} processing message{job.errors.length !== 1 ? 's' : ''}
            </summary>
            <ul>
              {job.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {done ? (
        <button className="icon-button" onClick={onDismiss} aria-label="Dismiss processing report">
          <X size={18} />
        </button>
      ) : (
        <span className="processing-percent">{progress}%</span>
      )}
    </div>
  );
}

import { CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { ProcessingJob } from '../../types';

function processingHeading(status: ProcessingJob['status']) {
  const headings = {
    failed: 'Processing could not be completed',
    completed: 'Your collection is up to date',
    queued: 'Your images are queued for indexing',
    processing: 'Finding objects in your images…',
  };
  return headings[status];
}

function processingMessages(errors: string[]) {
  const occurrences = new Map<string, number>();
  return errors.map((message) => {
    const occurrence = (occurrences.get(message) ?? 0) + 1;
    occurrences.set(message, occurrence);
    return { key: `${message}:${occurrence}`, message };
  });
}

export function ProcessingStatus({
  job,
  onDismiss,
}: Readonly<{
  job: ProcessingJob;
  onDismiss: () => void;
}>) {
  const done = job.status === 'completed' || job.status === 'failed';
  const failed = job.status === 'failed';
  const progress = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  let Icon = LoaderCircle;
  if (failed) Icon = CircleAlert;
  else if (done) Icon = CheckCircle2;
  const duplicatePlural = job.duplicates === 1 ? '' : 's';
  const description = done
    ? `${job.uploaded} indexed · ${job.duplicates} duplicate${duplicatePlural} skipped · ${job.failed} failed`
    : `${job.processed} of ${job.total} images processed. You can keep exploring while YOLO works.`;
  return (
    <div
      className={`processing-status ${done ? 'finished' : ''} ${failed ? 'failed' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="processing-icon">
        <Icon size={22} className={done ? undefined : 'spin'} />
      </div>
      <div className="processing-content">
        <strong>{processingHeading(job.status)}</strong>
        <p>{description}</p>
        {!done && (
          <progress
            className="progress-track"
            aria-label="Image processing progress"
            value={progress}
            max={100}
          />
        )}
        {job.errors.length > 0 && (
          <details className="processing-errors">
            <summary>
              View {job.errors.length} processing message{job.errors.length !== 1 ? 's' : ''}
            </summary>
            <ul>
              {processingMessages(job.errors).map(({ key, message }) => (
                <li key={key}>{message}</li>
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

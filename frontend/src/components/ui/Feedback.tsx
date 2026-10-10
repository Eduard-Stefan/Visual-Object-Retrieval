import { AlertCircle, ArrowRight, ImagePlus, LoaderCircle, SearchX, ScanLine } from 'lucide-react';
import type { ReactNode } from 'react';

export function ErrorNotice({
  message,
  onRetry,
}: Readonly<{ message: string; onRetry?: () => void }>) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={18} />
      <div>
        <strong>Something needs your attention</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button className="text-button" onClick={onRetry}>
          Try again <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  type,
  title,
  children,
  onUpload,
}: Readonly<{
  type: 'collection' | 'search' | 'objects';
  title: string;
  children: ReactNode;
  onUpload?: () => void;
}>) {
  const icons = { collection: ImagePlus, search: SearchX, objects: ScanLine };
  const Icon = icons[type];
  return (
    <div className="empty-state">
      <div className="empty-illustration">
        <span />
        <Icon size={34} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {onUpload && (
        <button className="button button-primary" onClick={onUpload}>
          <ImagePlus size={17} /> Upload your first images
        </button>
      )}
    </div>
  );
}

export function GallerySkeleton() {
  return (
    <div className="gallery-grid" aria-label="Loading images" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="image-card skeleton-card" key={index}>
          <div className="skeleton skeleton-photo" />
          <div className="skeleton-card-content">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <span className="spinner-label">
      <LoaderCircle size={16} className="spin" />
      {children}
    </span>
  );
}

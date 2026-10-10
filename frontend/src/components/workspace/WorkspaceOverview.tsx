import {
  Check,
  ChevronRight,
  Cpu,
  ImagePlus,
  Layers3,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { CollectionController } from '../../hooks/useCollection';
import type { SystemInfo, View } from '../../types';
import { errorMessage, percent } from '../../lib/format';
import { ProcessingStatus } from '../upload/ProcessingStatus';
import { SortSelect } from '../search/SearchPanel';
import { DistributionChart } from '../statistics/Statistics';
import { ErrorNotice, Spinner } from '../ui/Feedback';

const viewCopy = {
  search: {
    breadcrumb: 'Visual Search',
    title: 'Discover what’s in your images.',
    subtitle: 'Search your collection by the objects that matter. Powered by YOLO.',
  },
  collection: {
    breadcrumb: 'Image Collection',
    title: 'Your image collection',
    subtitle: 'Every image, every detection. Organized in one place.',
  },
  statistics: {
    breadcrumb: 'Collection Insights',
    title: 'A clearer view of your collection',
    subtitle: 'Understand the visual patterns in your indexed images.',
  },
};

function engineStatus(system?: SystemInfo, offline = false) {
  if (offline) return 'Backend offline';
  if (system?.ready) return 'Vision engine ready';
  if (system?.error) return 'Engine needs attention';
  return system ? 'Ready to index' : 'Connecting to backend';
}

export function WorkspaceHeader({ model }: Readonly<{ model: CollectionController }>) {
  const { view, system } = model;
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>Workspace</span>
        <ChevronRight size={13} />
        <strong>{viewCopy[view].breadcrumb}</strong>
      </div>
      <div className="topbar-right">
        <span className="local-badge">
          <ShieldCheck size={14} />
          Local & private
        </span>
        <span className={`system-badge ${system.data?.ready ? 'ready' : ''}`}>
          <span className="status-dot" />
          {engineStatus(system.data, system.isError)}
        </span>
        <span className="avatar">
          <ScanLine size={19} />
        </span>
      </div>
    </header>
  );
}

export function PageHeading({
  view,
  onUpload,
  busy,
}: Readonly<{ view: View; onUpload: () => void; busy: boolean }>) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          <Sparkles size={14} />
          AI-POWERED IMAGE SEARCH WITH YOLO
        </div>
        <h1>{viewCopy[view].title}</h1>
        <p>{viewCopy[view].subtitle}</p>
      </div>
      <button className="button button-primary heading-upload" onClick={onUpload} disabled={busy}>
        <ImagePlus size={17} />
        Upload Images
      </button>
    </div>
  );
}

export function CollectionFeedback({ model }: Readonly<{ model: CollectionController }>) {
  const { system, notice, job, setNotice, dismissJob, refreshCollection } = model;
  return (
    <>
      {system.isError && (
        <ErrorNotice
          message="The backend is unavailable. Start the FastAPI server to access your collection."
          onRetry={() => {
            void system.refetch();
            void refreshCollection();
          }}
        />
      )}
      {system.data?.error && (
        <ErrorNotice
          message={`The detection engine could not initialize: ${system.data.error}. Existing indexed images remain searchable.`}
          onRetry={() => void system.refetch()}
        />
      )}
      {system.data?.warnings?.map((warning) => (
        <output className="system-warning" key={warning}>
          <Cpu size={16} />
          <span>{warning}</span>
        </output>
      ))}
      {notice && (
        <output className="notice">
          <Check size={16} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </output>
      )}
      {job.data && <ProcessingStatus job={job.data} onDismiss={dismissJob} />}
      {job.isError && (
        <div className="job-error">
          <ErrorNotice
            message={`Unable to check processing progress: ${errorMessage(job.error)}`}
            onRetry={() => void job.refetch()}
          />
          <button className="text-button" onClick={dismissJob}>
            Dismiss progress tracker
          </button>
        </div>
      )}
    </>
  );
}

export function CollectionToolbar({ model }: Readonly<{ model: CollectionController }>) {
  const {
    minConfidence,
    confidence,
    sort,
    statistics,
    processing,
    setConfidence,
    setPage,
    setSort,
    deletion,
    setConfirmation,
  } = model;
  return (
    <div className="collection-toolbar panel">
      <div>
        <Layers3 size={20} />
        <div>
          <strong>Manage Collection</strong>
          <span>Original images and detections are saved on this computer.</span>
        </div>
      </div>
      <div className="collection-actions">
        <label className="collection-confidence">
          Minimum Confidence{' '}
          <input
            aria-label="Collection confidence threshold"
            type="range"
            min={minConfidence}
            max="1"
            step="0.01"
            value={confidence}
            onChange={(event) => {
              setConfidence(Number(event.target.value));
              setPage(1);
            }}
          />
          <span>{percent(confidence)}</span>
        </label>
        <SortSelect
          value={sort}
          onChange={(value) => {
            setSort(value);
            setPage(1);
          }}
        />
        <button
          className="button button-danger-outline"
          onClick={() => {
            deletion.reset();
            setConfirmation({});
          }}
          disabled={!statistics.data?.total_images || processing}
        >
          <Trash2 size={15} />
          Clear Collection
        </button>
      </div>
    </div>
  );
}

export function CollectionInsights({ model }: Readonly<{ model: CollectionController }>) {
  const { view, statistics } = model;
  let chart = null;
  if (statistics.data) chart = <DistributionChart data={statistics.data} />;
  else if (statistics.isLoading)
    chart = (
      <output className="panel chart-loading">
        <Spinner>Loading collection insights…</Spinner>
      </output>
    );
  return (
    <>
      {view === 'search' &&
        !!statistics.data?.total_images &&
        !statistics.data?.total_categories && (
          <div className="no-detections-note">
            <ScanLine size={19} />
            <div>
              <strong>No objects meet this threshold.</strong>
              <p>
                Try lowering confidence. YOLO recognizes 80 COCO categories; it may not detect
                objects outside those categories.
              </p>
            </div>
          </div>
        )}
      {(view === 'statistics' || view === 'search') && chart}
      {view === 'statistics' && (
        <section className="index-explainer panel">
          <span className="index-explainer-icon">
            <Search size={25} />
          </span>
          <div>
            <h3>Detected once. Searchable whenever.</h3>
            <p>
              YOLO extracts categories, locations, and confidence scores. Search reads that
              persistent index, so changing a filter never reruns detection.
            </p>
          </div>
        </section>
      )}
    </>
  );
}

export function WorkspaceFooter({ system }: Readonly<{ system?: SystemInfo }>) {
  return (
    <footer className="app-footer">
      <span>
        Visual Object Retrieval <span>·</span> Multimedia Information Retrieval
      </span>
      <span>
        <Cpu size={12} />
        {system?.model ?? 'YOLO11'}
        {system &&
          ` · ${system.device.toUpperCase()} · Detection floor ${percent(system.detection_confidence)}`}
      </span>
    </footer>
  );
}

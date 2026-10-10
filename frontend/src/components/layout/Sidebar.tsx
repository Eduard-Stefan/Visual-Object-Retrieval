import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  ChevronRight,
  Cpu,
  Database,
  Images,
  Scan,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { SystemInfo, View } from '../../types';

export function Sidebar({
  view,
  onView,
  onUpload,
  processing,
  system,
  total,
}: {
  view: View;
  onView: (value: View) => void;
  onUpload: () => void;
  processing: boolean;
  system?: SystemInfo;
  total?: number;
}) {
  const nav = [
    { value: 'search' as const, label: 'Visual Search', Icon: Search },
    { value: 'collection' as const, label: 'Image Collection', Icon: Images },
    { value: 'statistics' as const, label: 'Collection Insights', Icon: BarChart3 },
  ];
  return (
    <aside className="sidebar">
      <a
        className="brand"
        href="#"
        onClick={(event) => {
          event.preventDefault();
          onView('search');
        }}
        aria-label="Visual Object Retrieval home"
      >
        <span className="brand-icon">
          <Scan size={25} strokeWidth={1.8} />
        </span>
        <span>
          Visual<span className="brand-second">Object Retrieval</span>
        </span>
      </a>
      <span className="workspace-label">YOUR WORKSPACE</span>
      <nav aria-label="Main navigation">
        {nav.map(({ value, label, Icon }) => (
          <button
            className={`nav-item ${view === value ? 'active' : ''}`}
            onClick={() => onView(value)}
            key={value}
            aria-current={view === value ? 'page' : undefined}
          >
            <Icon size={18} />
            <span>{label}</span>
            {value === 'collection' && total !== undefined ? (
              <small>{total}</small>
            ) : view === value ? (
              <ChevronRight size={14} />
            ) : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-divider" />
      <button className="button sidebar-upload" onClick={onUpload} disabled={processing}>
        <Upload size={17} />
        {processing ? 'Indexing Images…' : 'Upload Images'}
      </button>
      <div className="sidebar-tip">
        <span className="tip-icon">
          <Sparkles size={20} />
        </span>
        <h3>See beyond filenames.</h3>
        <p>Find images by what is in them. Let AI organize the details.</p>
        <div className="tip-pipeline">
          <span>Upload</span>
          <ChevronRight size={11} />
          <span>Index</span>
          <ChevronRight size={11} />
          <span>Explore</span>
        </div>
      </div>
      <div className="sidebar-bottom">
        <div className="local-storage-note">
          <Database size={15} />
          <span>Your collection stays local</span>
        </div>
        <div className="model-card">
          <span className={`status-dot ${system?.ready ? 'online' : ''}`} />
          <div>
            <strong>
              {system?.model?.replace('.pt', '').toUpperCase() ?? 'YOLO VISION ENGINE'}
            </strong>
            <span>
              <Cpu size={11} />
              {system?.ready
                ? `${system.device.toUpperCase()}${system.half ? ' · FP16' : ' · FP32'}`
                : system?.error
                  ? 'Detection needs attention'
                  : system
                    ? 'Loads on first upload'
                    : 'Connecting to backend'}
            </span>
          </div>
          <span className="model-card-icon">
            <Scan size={16} />
          </span>
        </div>
        <a
          className="documentation-link"
          href="https://docs.ultralytics.com/models/yolo11/"
          target="_blank"
          rel="noreferrer"
        >
          <BookOpen size={14} />
          About YOLO
          <ArrowUpRight size={13} />
        </a>
      </div>
    </aside>
  );
}

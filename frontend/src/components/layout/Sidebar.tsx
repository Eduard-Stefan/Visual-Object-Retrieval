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

function engineDescription(system?: SystemInfo) {
  if (system?.ready) return `${system.device.toUpperCase()}${system.half ? ' · FP16' : ' · FP32'}`;
  if (system?.error) return 'Detection needs attention';
  return system ? 'Loads on first upload' : 'Connecting to backend';
}

function NavigationIndicator({
  value,
  view,
  total,
}: Readonly<{ value: View; view: View; total?: number }>) {
  if (value === 'collection' && total !== undefined) return <small>{total}</small>;
  return view === value ? <ChevronRight size={14} /> : null;
}

export function Sidebar({
  view,
  onView,
  onUpload,
  processing,
  system,
  total,
}: Readonly<{
  view: View;
  onView: (value: View) => void;
  onUpload: () => void;
  processing: boolean;
  system?: SystemInfo;
  total?: number;
}>) {
  const nav = [
    { value: 'search' as const, label: 'Visual Search', Icon: Search },
    { value: 'collection' as const, label: 'Image Collection', Icon: Images },
    { value: 'statistics' as const, label: 'Collection Insights', Icon: BarChart3 },
  ];
  return (
    <aside className="sidebar">
      <button
        className="brand"
        type="button"
        onClick={() => onView('search')}
        aria-label="Visual Object Retrieval home"
      >
        <span className="brand-icon">
          <Scan size={25} strokeWidth={1.8} />
        </span>
        <span>
          Visual<span className="brand-second">Object Retrieval</span>
        </span>
      </button>
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
            <NavigationIndicator value={value} view={view} total={total} />
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
              {engineDescription(system)}
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

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Cpu,
  Eye,
  ImagePlus,
  Layers3,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { IndexedImage, SearchMode, SortOrder, View } from './types';
import { api } from './services/api';
import { errorMessage, label, number, percent } from './lib/format';
import { Sidebar } from './components/layout/Sidebar';
import { UploadPanel } from './components/upload/UploadPanel';
import { ProcessingStatus } from './components/upload/ProcessingStatus';
import { SearchPanel, SortSelect } from './components/search/SearchPanel';
import { StatisticCards, DistributionChart } from './components/statistics/Statistics';
import { ImageCard } from './components/gallery/ImageCard';
import { ImageDetail } from './components/gallery/ImageDetail';
import { EmptyState, ErrorNotice, GallerySkeleton, Spinner } from './components/ui/Feedback';
import { Modal } from './components/ui/Modal';

type ActiveSearch = { categories: string[]; mode: SearchMode } | null;

export default function App() {
  const client = useQueryClient();
  const [view, setView] = useState<View>('search');
  const [confidence, setConfidence] = useState(0.5);
  const [selected, setSelected] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [mode, setMode] = useState<SearchMode>('and');
  const [sort, setSort] = useState<SortOrder>('confidence_desc');
  const [page, setPage] = useState(1);
  const [activeSearch, setActiveSearch] = useState<ActiveSearch>(null);
  const [annotated, setAnnotated] = useState(true);
  const [showOthers, setShowOthers] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailImage, setDetailImage] = useState<IndexedImage | null>(null);
  const [confirmation, setConfirmation] = useState<{ image?: IndexedImage } | null>(null);
  const [notice, setNotice] = useState('');
  const [jobId, setJobId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('vor-processing-job');
    } catch {
      return null;
    }
  });
  const lastJobProgress = useRef('');
  const system = useQuery({
    queryKey: ['system'],
    queryFn: api.system,
    refetchInterval: (query) => (query.state.data?.ready ? 30_000 : 5_000),
  });
  const minConfidence = Math.max(0.01, Math.min(1, system.data?.detection_confidence ?? 0.15));
  const categories = useQuery({
    queryKey: ['categories', confidence],
    queryFn: () => api.categories(confidence),
  });
  const statistics = useQuery({
    queryKey: ['statistics', confidence],
    queryFn: () => api.statistics(confidence),
  });
  const currentSearch = view === 'search' ? activeSearch : null;
  const images = useQuery({
    queryKey: ['images', view, confidence, sort, page, currentSearch],
    queryFn: () =>
      currentSearch
        ? currentSearch.categories.length
          ? api.search(currentSearch.categories, currentSearch.mode, confidence, sort, page)
          : Promise.resolve({ items: [], total: 0, page, page_size: 24 })
        : api.images(confidence, sort, page),
    enabled: view !== 'statistics',
  });
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) =>
      ['completed', 'failed'].includes(query.state.data?.status ?? '') ? false : 1200,
    retry: 2,
  });
  const processing = !!jobId && (!job.data || !['completed', 'failed'].includes(job.data.status));

  async function refreshCollection() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['images'] }),
      client.invalidateQueries({ queryKey: ['categories'] }),
      client.invalidateQueries({ queryKey: ['statistics'] }),
      client.invalidateQueries({ queryKey: ['image'] }),
      client.invalidateQueries({ queryKey: ['system'] }),
    ]);
  }
  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: (result) => {
      setJobId(result.job_id);
      try {
        localStorage.setItem('vor-processing-job', result.job_id);
      } catch {
        /* Progress still works without browser storage. */
      }
      setUploadOpen(false);
      setPage(1);
    },
  });
  const retryIndexing = useMutation({
    mutationFn: (image: IndexedImage) => api.retryImage(image.id),
    onSuccess: (result) => {
      setJobId(result.job_id);
      try {
        localStorage.setItem('vor-processing-job', result.job_id);
      } catch {
        /* Browser storage is optional. */
      }
      setDetailImage(null);
      void refreshCollection();
    },
  });
  const deletion = useMutation({
    mutationFn: (target: { image?: IndexedImage }) =>
      target.image ? api.deleteImage(target.image.id) : api.clearCollection(),
    onSuccess: async (_, target) => {
      setConfirmation(null);
      if (!target.image || detailImage?.id === target.image.id) setDetailImage(null);
      setPage(1);
      setNotice(
        target.image
          ? `${target.image.filename} was removed from your collection.`
          : 'Your image collection has been cleared.',
      );
      await refreshCollection();
    },
  });

  useEffect(() => {
    if (!job.data) return;
    const key = `${job.data.id}:${job.data.processed}:${job.data.status}`;
    if (lastJobProgress.current === key) return;
    lastJobProgress.current = key;
    void refreshCollection();
  }, [job.data?.id, job.data?.processed, job.data?.status]);

  useEffect(() => {
    if (!categories.isSuccess || !categories.data) return;
    const available = new Set(categories.data.map((category) => category.class_name));
    if (!selected.every((name) => available.has(name))) {
      setSelected(selected.filter((name) => available.has(name)));
      setNotice(
        'Some selected categories no longer meet the current confidence threshold and were removed.',
      );
    }
    if (activeSearch && !activeSearch.categories.every((name) => available.has(name))) {
      setNotice(
        'Some selected categories no longer meet the current confidence threshold and were removed.',
      );
      setActiveSearch({
        ...activeSearch,
        categories: activeSearch.categories.filter((name) => available.has(name)),
      });
    }
  }, [categories.data, categories.isSuccess, selected, activeSearch]);

  useEffect(() => {
    if (images.data && page > 1 && !images.data.items.length)
      setPage(Math.max(1, Math.ceil(images.data.total / 24)));
  }, [images.data, page]);

  useEffect(() => {
    if (confidence < minConfidence) {
      setConfidence(minConfidence);
      setPage(1);
    }
  }, [minConfidence, confidence]);

  function resetFilters() {
    setSelected([]);
    setActiveSearch(null);
    setConfidence(Math.max(0.5, minConfidence));
    setSort('confidence_desc');
    setMode('and');
    setAdvanced(false);
    setPage(1);
    setNotice('');
  }
  function changeView(value: View) {
    setView(value);
    setPage(1);
  }
  function openUpload() {
    upload.reset();
    setUploadOpen(true);
  }
  function dismissJob() {
    setJobId(null);
    try {
      localStorage.removeItem('vor-processing-job');
    } catch {
      /* Browser storage is optional. */
    }
  }
  const matchingCategories = currentSearch?.categories ?? [];
  const pageCount = Math.max(1, Math.ceil((images.data?.total ?? 0) / 24));
  const title =
    view === 'collection'
      ? 'Your image collection'
      : view === 'statistics'
        ? 'A clearer view of your collection'
        : 'Discover what’s in your images.';
  const subtitle =
    view === 'collection'
      ? 'Every image, every detection. Organized in one place.'
      : view === 'statistics'
        ? 'Understand the visual patterns in your indexed images.'
        : 'Search your collection by the objects that matter. Powered by YOLO.';

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onView={changeView}
        onUpload={openUpload}
        processing={processing || upload.isPending}
        system={system.data}
        total={statistics.data?.total_images}
      />
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === 'search'
                ? 'Visual Search'
                : view === 'collection'
                  ? 'Image Collection'
                  : 'Collection Insights'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <ShieldCheck size={14} />
              Local & private
            </span>
            <span className={`system-badge ${system.data?.ready ? 'ready' : ''}`}>
              <span className="status-dot" />
              {system.isError
                ? 'Backend offline'
                : system.data?.ready
                  ? 'Vision engine ready'
                  : system.data?.error
                    ? 'Engine needs attention'
                    : system.data
                      ? 'Ready to index'
                      : 'Connecting to backend'}
            </span>
            <span className="avatar">
              <ScanLine size={19} />
            </span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <Sparkles size={14} />
                AI-POWERED IMAGE SEARCH WITH YOLO
              </div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <button
              className="button button-primary heading-upload"
              onClick={openUpload}
              disabled={processing || upload.isPending}
            >
              <ImagePlus size={17} />
              Upload Images
            </button>
          </div>
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
            <div className="system-warning" role="status" key={warning}>
              <Cpu size={16} />
              <span>{warning}</span>
            </div>
          ))}
          {notice && (
            <div className="notice" role="status">
              <Check size={16} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice('')}
              >
                <X size={15} />
              </button>
            </div>
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
          <StatisticCards
            data={statistics.data}
            results={view === 'statistics' ? undefined : images.data?.total}
            loading={statistics.isLoading}
          />
          {statistics.isError && !system.isError && (
            <ErrorNotice
              message={errorMessage(statistics.error)}
              onRetry={() => void statistics.refetch()}
            />
          )}
          {view === 'search' && (
            <SearchPanel
              categories={categories.data ?? []}
              selected={selected}
              onSelected={setSelected}
              advanced={advanced}
              onAdvanced={setAdvanced}
              mode={mode}
              onMode={setMode}
              confidence={confidence}
              minConfidence={minConfidence}
              onConfidence={(value) => {
                setConfidence(value);
                setPage(1);
              }}
              sort={sort}
              onSort={(value) => {
                setSort(value);
                setPage(1);
              }}
              onSearch={() => {
                setActiveSearch({ categories: [...selected], mode });
                setPage(1);
              }}
              onReset={resetFilters}
              loading={categories.isLoading}
              searching={images.isFetching && !!currentSearch}
            />
          )}
          {categories.isError && view === 'search' && !system.isError && (
            <ErrorNotice
              message={errorMessage(categories.error)}
              onRetry={() => void categories.refetch()}
            />
          )}
          {view === 'collection' && (
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
          )}
          {view !== 'statistics' && (
            <section className="results-section" aria-label="Image results">
              <div className="results-heading">
                <div>
                  <h2>
                    {currentSearch
                      ? 'Search Results'
                      : view === 'collection'
                        ? 'All Images'
                        : 'Explore Your Collection'}
                    {images.data && (
                      <span className="count-badge">{number(images.data.total)}</span>
                    )}
                  </h2>
                  <p>
                    {currentSearch
                      ? matchingCategories.length
                        ? `${matchingCategories.map(label).join(currentSearch.mode === 'and' ? ' + ' : ' or ')} · ${percent(confidence)} minimum confidence · ranked by matching detections`
                        : 'Choose another object or lower the threshold to start a new search.'
                      : 'Your visual library, ready to explore.'}
                  </p>
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
                      />
                      Show other objects
                    </label>
                  )}
                </div>
              </div>
              {images.isLoading ? (
                <GallerySkeleton />
              ) : images.isError ? (
                !system.isError && (
                  <ErrorNotice
                    message={errorMessage(images.error)}
                    onRetry={() => void images.refetch()}
                  />
                )
              ) : images.data?.items.length ? (
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
                      Showing {number((page - 1) * 24 + 1)}–
                      {number(Math.min(page * 24, images.data.total))} of{' '}
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
                      <span className="status-dot online" />
                      Persistent local index
                    </span>
                  </div>
                </>
              ) : processing ? (
                <EmptyState type="objects" title="Your visual index is taking shape">
                  Images will appear here as soon as they are processed. Progress is shown above.
                </EmptyState>
              ) : currentSearch ? (
                <EmptyState type="search" title="No matching images">
                  Try another object category, use OR to broaden your search, or lower the
                  confidence threshold.
                </EmptyState>
              ) : (
                <EmptyState
                  type="collection"
                  title="Your next discovery starts here"
                  onUpload={openUpload}
                >
                  Upload a few images. YOLO will identify their objects and build your searchable
                  collection automatically.
                </EmptyState>
              )}
            </section>
          )}
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
          {(view === 'statistics' || view === 'search') &&
            (statistics.data ? (
              <DistributionChart data={statistics.data} />
            ) : statistics.isLoading ? (
              <div className="panel chart-loading" role="status">
                <Spinner>Loading collection insights…</Spinner>
              </div>
            ) : null)}
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
          <footer className="app-footer">
            <span>
              Visual Object Retrieval <span>·</span> Multimedia Information Retrieval
            </span>
            <span>
              <Cpu size={12} />
              {system.data?.model ?? 'YOLO11'}
              {system.data &&
                ` · ${system.data.device.toUpperCase()} · Detection floor ${percent(system.data.detection_confidence)}`}
            </span>
          </footer>
        </main>
      </div>
      {uploadOpen && (
        <UploadPanel
          onClose={() => {
            if (!upload.isPending) setUploadOpen(false);
          }}
          onUpload={(files) => upload.mutate(files)}
          busy={upload.isPending}
          error={upload.isError ? errorMessage(upload.error) : undefined}
          limits={{
            maxFileMb: system.data?.max_file_mb ?? 20,
            maxFiles: system.data?.max_upload_files ?? 50,
            maxBodyMb: system.data?.max_upload_body_mb ?? 256,
          }}
        />
      )}
      {detailImage && !confirmation && (
        <ImageDetail
          image={detailImage}
          confidence={confidence}
          selected={matchingCategories}
          onClose={() => setDetailImage(null)}
          onDelete={(image) => {
            deletion.reset();
            setConfirmation({ image });
          }}
          onRetry={(image) => retryIndexing.mutate(image)}
          retrying={retryIndexing.isPending || processing}
          retryError={retryIndexing.isError ? errorMessage(retryIndexing.error) : undefined}
        />
      )}
      {confirmation && (
        <Modal
          title={confirmation.image ? 'Delete this image?' : 'Clear your collection?'}
          description={
            confirmation.image
              ? `“${confirmation.image.filename}” and its indexed detections will be permanently removed.`
              : 'All images, thumbnails, and indexed detections will be permanently removed. This cannot be undone.'
          }
          onClose={() => {
            if (!deletion.isPending) setConfirmation(null);
          }}
        >
          <div className="modal-body confirmation-body">
            <span className="delete-illustration">
              <Trash2 size={30} />
            </span>
            <p>
              {confirmation.image
                ? 'Your other images and their detections will stay in your collection.'
                : 'You can build a new collection by uploading images again.'}
            </p>
            {deletion.isError && <ErrorNotice message={errorMessage(deletion.error)} />}
          </div>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={() => setConfirmation(null)}
              disabled={deletion.isPending}
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              onClick={() => deletion.mutate(confirmation)}
              disabled={deletion.isPending}
            >
              {deletion.isPending ? (
                <Spinner>Removing…</Spinner>
              ) : (
                <>
                  <Trash2 size={15} />
                  {confirmation.image ? 'Delete Image' : 'Clear Collection'}
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

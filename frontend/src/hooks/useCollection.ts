import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IndexedImage, PaginatedImages, SearchMode, SortOrder, View } from '../types';
import { api } from '../services/api';

type ActiveSearch = { categories: string[]; mode: SearchMode } | null;

function loadImages(
  search: ActiveSearch,
  confidence: number,
  sort: SortOrder,
  page: number,
): Promise<PaginatedImages> {
  if (!search) return api.images(confidence, sort, page);
  if (search.categories.length === 0)
    return Promise.resolve({ items: [], total: 0, page, page_size: 24 });
  return api.search(search.categories, search.mode, confidence, sort, page);
}

export function useCollection() {
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
    queryFn: () => loadImages(currentSearch, confidence, sort, page),
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
  return {
    view,
    confidence,
    selected,
    advanced,
    mode,
    sort,
    page,
    activeSearch,
    annotated,
    showOthers,
    uploadOpen,
    detailImage,
    confirmation,
    notice,
    system,
    minConfidence,
    categories,
    statistics,
    currentSearch,
    images,
    job,
    processing,
    upload,
    retryIndexing,
    deletion,
    setConfidence,
    setSelected,
    setAdvanced,
    setMode,
    setSort,
    setPage,
    setActiveSearch,
    setAnnotated,
    setShowOthers,
    setUploadOpen,
    setDetailImage,
    setConfirmation,
    setNotice,
    refreshCollection,
    resetFilters,
    changeView,
    openUpload,
    dismissJob,
  };
}

export type CollectionController = ReturnType<typeof useCollection>;

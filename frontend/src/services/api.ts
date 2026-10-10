import type {
  Category,
  IndexedImage,
  PaginatedImages,
  ProcessingJob,
  SearchMode,
  SortOrder,
  Statistics,
  SystemInfo,
} from '../types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error('The backend is unavailable. Start the FastAPI server and try again.');
  }
  if (!response.ok) {
    let message = `The request failed (${response.status}). Please try again.`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') message = body.detail;
      else if (typeof body.error === 'string') message = body.error;
      else if (Array.isArray(body.detail))
        message = body.detail
          .map((item: { msg?: string }) => item.msg ?? 'Invalid request')
          .join('. ');
    } catch {
      /* Some server failures have no JSON response. */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  system: () => request<SystemInfo>('/system'),
  categories: (confidence: number) =>
    request<Category[]>(`/search/categories?confidence=${confidence}`),
  statistics: (confidence: number) => request<Statistics>(`/statistics?confidence=${confidence}`),
  images: (confidence: number, sort: SortOrder, page: number) =>
    request<PaginatedImages>(
      `/images?confidence=${confidence}&sort=${sort}&page=${page}&page_size=24`,
    ),
  image: (id: string, confidence: number) =>
    request<IndexedImage>(`/images/${id}?confidence=${confidence}`),
  search: (
    categories: string[],
    mode: SearchMode,
    confidence: number,
    sort: SortOrder,
    page: number,
  ) =>
    request<PaginatedImages>('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories, mode, confidence, sort, page, page_size: 24 }),
    }),
  upload: (files: File[]) => {
    const body = new FormData();
    files.forEach((file) => body.append('files', file));
    return request<{ job_id: string; total: number }>('/images/upload', { method: 'POST', body });
  },
  job: (id: string) => request<ProcessingJob>(`/jobs/${id}`),
  deleteImage: (id: string) => request<void>(`/images/${id}`, { method: 'DELETE' }),
  retryImage: (id: string) =>
    request<{ job_id: string; total: number }>(`/images/${id}/retry`, { method: 'POST' }),
  clearCollection: () => request<void>('/images', { method: 'DELETE' }),
};

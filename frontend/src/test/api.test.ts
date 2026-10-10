import { describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';

function mockResponse(body: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('backend API client', () => {
  it('sends the full multi-object query, threshold, ranking, and page', async () => {
    const fetch = mockResponse({ items: [], total: 0, page: 2, page_size: 24 });
    await api.search(['person', 'car'], 'and', 0.75, 'confidence_asc', 2);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/search');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      categories: ['person', 'car'],
      mode: 'and',
      confidence: 0.75,
      sort: 'confidence_asc',
      page: 2,
      page_size: 24,
    });
  });

  it('applies the confidence threshold to collection and detail requests', async () => {
    const fetch = mockResponse({});
    await api.images(0.8, 'newest', 3);
    await api.image('image-one', 0.8);
    await api.categories(0.8);
    await api.statistics(0.8);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      '/api/images?confidence=0.8&sort=newest&page=3&page_size=24',
      '/api/images/image-one?confidence=0.8',
      '/api/search/categories?confidence=0.8',
      '/api/statistics?confidence=0.8',
    ]);
  });

  it('uploads each selected image under the multipart files field', async () => {
    const fetch = mockResponse({ job_id: 'job-one', total: 2 }, 202);
    const files = [new File(['first'], 'first.png'), new File(['second'], 'second.jpg')];
    expect(await api.upload(files)).toEqual({ job_id: 'job-one', total: 2 });
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/images/upload');
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.getAll('files').map((file: File) => file.name)).toEqual([
      'first.png',
      'second.jpg',
    ]);
    expect(options.headers).toBeUndefined();
  });

  it('turns network failures into a clear backend-unavailable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.system()).rejects.toThrow(
      'The backend is unavailable. Start the FastAPI server and try again.',
    );
  });

  it('preserves actionable server error text', async () => {
    mockResponse({ detail: 'The processing queue is full. Wait for the current batch.' }, 429);
    await expect(api.upload([])).rejects.toThrow(
      'The processing queue is full. Wait for the current batch.',
    );
  });

  it('presents field validation errors as readable text', async () => {
    mockResponse({ detail: [{ msg: 'Confidence must be at most 1' }] }, 422);
    await expect(api.categories(2)).rejects.toThrow('Confidence must be at most 1');
  });

  it('handles a non-JSON server failure without exposing raw HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Proxy failed</html>', { status: 502 })),
    );
    await expect(api.system()).rejects.toThrow('The request failed (502). Please try again.');
  });

  it('accepts empty 204 responses after deletion', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.deleteImage('image-one')).resolves.toBeUndefined();
    await expect(api.clearCollection()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/images/image-one', { method: 'DELETE' });
    expect(fetch).toHaveBeenCalledWith('/api/images', { method: 'DELETE' });
  });
});

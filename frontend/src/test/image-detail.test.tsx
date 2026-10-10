import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageDetail } from '../components/gallery/ImageDetail';
import type { IndexedImage } from '../types';
import { indexedImage } from './fixtures';

function renderDetail(image: IndexedImage = indexedImage) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } },
  });
  const onRetry = vi.fn();
  const onDelete = vi.fn();
  const result = render(
    <QueryClientProvider client={client}>
      <ImageDetail
        image={image}
        confidence={0.5}
        selected={['car']}
        onClose={vi.fn()}
        onDelete={onDelete}
        onRetry={onRetry}
      />
    </QueryClientProvider>,
  );
  return { ...result, onRetry, onDelete };
}

describe('image detail viewer', () => {
  it('toggles stored annotations and downloads normalized image bytes as JPEG', async () => {
    const user = userEvent.setup();
    renderDetail();
    expect(screen.getByRole('img', { name: '2 detected objects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download image' })).toHaveAttribute(
      'download',
      'street.jpg',
    );
    await user.click(screen.getByRole('button', { name: 'Original' }));
    expect(screen.queryByRole('img', { name: /detected objects/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annotated' }));
    expect(screen.getByRole('img', { name: '2 detected objects' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Show other detections' }));
    expect(screen.getByRole('img', { name: '1 detected objects' })).toBeInTheDocument();
  });

  it('explains model failures and lets the user retry the failed image', async () => {
    const user = userEvent.setup();
    const failed = {
      ...indexedImage,
      model: null,
      status: 'failed',
      detections: [],
      error: 'Could not load YOLO weights. Check the internet connection.',
    };
    const { onRetry } = renderDetail(failed);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load YOLO weights');
    expect(screen.getByText('Retry indexing to detect objects in this image.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry Indexing' }));
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(failed);
  });

  it('passes the inspected image to the delete confirmation flow', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderDetail();
    await user.click(screen.getByRole('button', { name: 'Delete Image' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(indexedImage);
  });
});

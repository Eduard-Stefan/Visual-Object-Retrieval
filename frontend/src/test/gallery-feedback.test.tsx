import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnnotatedImage } from '../components/gallery/AnnotatedImage';
import { ImageCard } from '../components/gallery/ImageCard';
import { ProcessingStatus } from '../components/upload/ProcessingStatus';
import { EmptyState, ErrorNotice, GallerySkeleton } from '../components/ui/Feedback';
import { indexedImage, processingJob } from './fixtures';

describe('retrieved image presentation', () => {
  it('shows the matching object count and confidence rather than another object score', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ImageCard
        image={indexedImage}
        confidence={0.5}
        annotated
        selected={['car']}
        showOthers
        onOpen={onOpen}
      />,
    );
    expect(screen.getByRole('heading', { name: 'street.png' })).toBeInTheDocument();
    expect(screen.getByText(/1 matching object/)).toBeInTheDocument();
    expect(screen.getByText('80% confidence')).toBeInTheDocument();
    expect(screen.queryByText('90% confidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Dog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View Details for street.png' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('keeps coordinates in the original image view box and supports hiding unrelated annotations', () => {
    const { rerender } = render(
      <AnnotatedImage
        image={indexedImage}
        confidence={0.5}
        annotated
        selected={['car']}
        showOthers
      />,
    );
    expect(screen.getByRole('img', { name: '2 detected objects' })).toHaveAttribute(
      'viewBox',
      '0 0 800 600',
    );
    expect(screen.getByText('Person 90%')).toBeInTheDocument();
    rerender(
      <AnnotatedImage
        image={indexedImage}
        confidence={0.5}
        annotated
        selected={['car']}
        showOthers={false}
      />,
    );
    expect(screen.getByRole('img', { name: '1 detected objects' })).toBeInTheDocument();
    expect(screen.queryByText('Person 90%')).not.toBeInTheDocument();
    expect(screen.getByText('Car 80%')).toBeInTheDocument();
  });

  it('uses the full image without annotations for original view', () => {
    render(<AnnotatedImage image={indexedImage} confidence={0.5} annotated={false} original />);
    expect(screen.getByRole('img', { name: 'street.png' })).toHaveAttribute(
      'src',
      indexedImage.file_url,
    );
    expect(screen.queryByRole('img', { name: /detected objects/i })).not.toBeInTheDocument();
  });
});

describe('loading, progress, empty, and failure states', () => {
  it('announces that the gallery is loading', () => {
    render(<GallerySkeleton />);
    expect(screen.getByLabelText('Loading images')).toHaveAttribute('aria-busy', 'true');
  });

  it('provides a useful empty collection action', async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    render(
      <EmptyState type="collection" title="Your next discovery starts here" onUpload={onUpload}>
        Upload images to start searching.
      </EmptyState>,
    );
    expect(
      screen.getByRole('heading', { name: 'Your next discovery starts here' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload your first images' }));
    expect(onUpload).toHaveBeenCalledOnce();
  });

  it('explains empty search results without showing an upload requirement', () => {
    render(
      <EmptyState type="search" title="No matching images">
        Choose another category or lower the threshold.
      </EmptyState>,
    );
    expect(screen.getByText('Choose another category or lower the threshold.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows an actionable API error and allows retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorNotice message="The backend is unavailable." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The backend is unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('reports processing progress accessibly without allowing dismissal of active work', () => {
    render(<ProcessingStatus job={processingJob} onDismiss={vi.fn()} />);
    expect(screen.getByRole('progressbar', { name: 'Image processing progress' })).toHaveAttribute(
      'value',
      '25',
    );
    expect(screen.getByText(/1 of 4 images processed/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dismiss processing report' }),
    ).not.toBeInTheDocument();
  });

  it('retains partial processing errors and allows dismissing the completed report', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ProcessingStatus
        job={{
          ...processingJob,
          status: 'completed',
          processed: 4,
          uploaded: 2,
          duplicates: 1,
          failed: 1,
          errors: ['broken.png could not be decoded.'],
        }}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('2 indexed · 1 duplicate skipped · 1 failed')).toBeInTheDocument();
    await user.click(screen.getByText('View 1 processing message'));
    expect(screen.getByText('broken.png could not be decoded.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Dismiss processing report' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

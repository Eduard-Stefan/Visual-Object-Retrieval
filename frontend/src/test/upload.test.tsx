import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UploadPanel } from '../components/upload/UploadPanel';

function renderUpload(props = {}) {
  const onUpload = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <UploadPanel onUpload={onUpload} onClose={onClose} busy={false} {...props} />,
  );
  return { ...result, onUpload, onClose };
}

describe('image upload interface', () => {
  it('previews supported files, skips selection duplicates, and submits the selected files', async () => {
    const user = userEvent.setup();
    const { onUpload } = renderUpload();
    const first = new File(['first image'], 'street.png', { type: 'image/png', lastModified: 1 });
    const second = new File(['second image'], 'park.webp', { type: 'image/webp', lastModified: 2 });
    const input = screen.getByLabelText('Choose images to upload');
    expect(screen.getByRole('button', { name: /upload & index/i })).toBeDisabled();
    await user.upload(input, [first, second]);
    await user.upload(input, first);
    expect(screen.getByText('2 images selected')).toBeInTheDocument();
    expect(screen.getByAltText('street.png')).toHaveAttribute('src', 'blob:test-image');
    await user.click(screen.getByRole('button', { name: /upload & index/i }));
    expect(onUpload).toHaveBeenCalledExactlyOnceWith([first, second]);
  });

  it('removes individual previews and allows clearing the selection', async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.upload(screen.getByLabelText('Choose images to upload'), [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Remove one.jpg' }));
    expect(screen.queryByAltText('one.jpg')).not.toBeInTheDocument();
    expect(screen.getByText('1 image selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove all' }));
    expect(screen.getByRole('button', { name: /upload & index/i })).toBeDisabled();
  });

  it('rejects unsupported, empty, and oversized files with readable messages', () => {
    renderUpload();
    const tooLarge = new File(['content'], 'large.png', { type: 'image/png' });
    Object.defineProperty(tooLarge, 'size', { value: 21 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Choose images to upload'), {
      target: {
        files: [
          new File(['script'], 'program.exe'),
          new File([], 'empty.jpg', { type: 'image/jpeg' }),
          tooLarge,
        ],
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('program.exe');
    expect(screen.getByRole('alert')).toHaveTextContent('empty.jpg: this file is empty');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'large.png: the maximum file size is 20 MB',
    );
    expect(screen.getByRole('button', { name: /upload & index/i })).toBeDisabled();
  });

  it('accepts drag and drop without immediately starting inference', async () => {
    const { onUpload } = renderUpload();
    const file = new File(['image'], 'dropped.png', { type: 'image/png' });
    fireEvent.drop(screen.getByRole('button', { name: /drop your images here/i }), {
      dataTransfer: { files: [file] },
    });
    await waitFor(() => expect(screen.getByAltText('dropped.png')).toBeInTheDocument());
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('disables submission while uploading and displays backend errors', () => {
    renderUpload({ busy: true, error: 'The processing queue is full. Try again shortly.' });
    expect(screen.getByLabelText('Choose images to upload')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The processing queue is full');
  });

  it('releases preview URLs when the dialog closes', async () => {
    const user = userEvent.setup();
    const { unmount } = renderUpload();
    await user.upload(
      screen.getByLabelText('Choose images to upload'),
      new File(['image'], 'preview.png', { type: 'image/png' }),
    );
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
  });

  it('uses configured per-file and batch-count limits', () => {
    renderUpload({ limits: { maxFileMb: 1, maxFiles: 2, maxBodyMb: 10 } });
    const tooLarge = new File(['image'], 'oversized.png', { type: 'image/png' });
    Object.defineProperty(tooLarge, 'size', { value: 2 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Choose images to upload'), {
      target: {
        files: [
          tooLarge,
          ...['one.png', 'two.png', 'three.png'].map(
            (name) => new File(['image'], name, { type: 'image/png' }),
          ),
        ],
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('the maximum file size is 1 MB');
    expect(screen.getByText('2 images selected')).toBeInTheDocument();
    expect(screen.queryByAltText('three.png')).not.toBeInTheDocument();
  });

  it('blocks oversized aggregate batches until enough files are removed', async () => {
    const user = userEvent.setup();
    renderUpload({ limits: { maxFileMb: 2, maxFiles: 50, maxBodyMb: 1 } });
    const files = ['one.png', 'two.png'].map((name) => {
      const file = new File(['image'], name, { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 600 * 1024 });
      return file;
    });
    fireEvent.change(screen.getByLabelText('Choose images to upload'), { target: { files } });
    expect(screen.getByRole('alert')).toHaveTextContent('1 MB total upload limit');
    expect(screen.getByRole('button', { name: /upload & index/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove one.png' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload & index/i })).toBeEnabled();
  });
});

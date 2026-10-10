import { useEffect, useRef, useState, type DragEvent } from 'react';
import { FileImage, ImagePlus, UploadCloud, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ErrorNotice, Spinner } from '../ui/Feedback';

const SUPPORTED = /\.(jpe?g|png|webp)$/i;

export function UploadPanel({
  onClose,
  onUpload,
  busy,
  error,
  limits = { maxFileMb: 20, maxFiles: 50, maxBodyMb: 256 },
}: Readonly<{
  onClose: () => void;
  onUpload: (files: File[]) => void;
  busy: boolean;
  error?: string;
  limits?: { maxFileMb: number; maxFiles: number; maxBodyMb: number };
}>) {
  const [files, setFiles] = useState<File[]>([]);
  const [validation, setValidation] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  function addFiles(incoming: File[]) {
    const messages: string[] = [];
    const valid = incoming.filter((file) => {
      if (!SUPPORTED.test(file.name)) {
        messages.push(`${file.name}: choose a JPG, PNG, or WEBP image.`);
        return false;
      }
      if (file.size > limits.maxFileMb * 1024 * 1024) {
        messages.push(`${file.name}: the maximum file size is ${limits.maxFileMb} MB.`);
        return false;
      }
      if (file.size === 0) {
        messages.push(`${file.name}: this file is empty.`);
        return false;
      }
      return true;
    });
    setFiles((previous) => {
      const next = [...previous];
      valid.forEach((file) => {
        if (
          !next.some(
            (existing) =>
              existing.name === file.name &&
              existing.size === file.size &&
              existing.lastModified === file.lastModified,
          )
        )
          next.push(file);
      });
      if (next.length > limits.maxFiles)
        messages.push(
          `You can upload up to ${limits.maxFiles} images in one batch. Only the first ${limits.maxFiles} have been selected.`,
        );
      return next.slice(0, limits.maxFiles);
    });
    setValidation(messages);
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy) addFiles(Array.from(event.dataTransfer.files));
  }
  const oversizedBatch =
    files.reduce((total, file) => total + file.size, 0) + files.length * 2048 >
    limits.maxBodyMb * 1024 * 1024;
  return (
    <Modal
      title="Upload Images"
      description="Turn your image collection into a searchable visual index."
      onClose={onClose}
    >
      <div className="modal-body">
        <input
          ref={input}
          className="sr-only"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          aria-label="Choose images to upload"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
          disabled={busy}
        />
        <button
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          disabled={busy}
        >
          <span className="upload-icon">
            <UploadCloud size={28} />
          </span>
          <strong>
            Drop your images here, or <em>browse files</em>
          </strong>
          <span>
            JPG, PNG, WEBP · Up to {limits.maxFileMb} MB each · {limits.maxFiles} images per batch
          </span>
        </button>
        {validation.length > 0 && (
          <div className="validation-errors" role="alert">
            {validation.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        {oversizedBatch && (
          <ErrorNotice
            message={`This batch exceeds the ${limits.maxBodyMb} MB total upload limit. Remove some images before uploading.`}
          />
        )}
        {files.length > 0 && (
          <>
            <div className="selected-files-heading">
              <strong>
                {files.length} image{files.length !== 1 ? 's' : ''} selected
              </strong>
              <button className="text-button" onClick={() => setFiles([])} disabled={busy}>
                Remove all
              </button>
            </div>
            <div className="upload-previews">
              {files.map((file, index) => (
                <div
                  className="upload-preview"
                  key={`${file.name}-${file.lastModified}-${file.size}`}
                >
                  <img src={previews[index]} alt={file.name} />
                  <div>
                    <strong>{file.name}</strong>
                    <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles((previous) => previous.filter((_, position) => index !== position))
                    }
                    disabled={busy}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="upload-explainer">
          <FileImage size={17} />
          <p>
            YOLO detects supported objects once. Your images and their searchable metadata are saved
            locally; duplicates are skipped automatically.
          </p>
        </div>
      </div>
      <div className="modal-footer">
        <button className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="button button-primary"
          disabled={!files.length || busy || oversizedBatch}
          onClick={() => onUpload(files)}
        >
          {busy ? (
            <Spinner>Uploading…</Spinner>
          ) : (
            <>
              <ImagePlus size={17} /> Upload & index{files.length ? ` ${files.length} images` : ''}
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}

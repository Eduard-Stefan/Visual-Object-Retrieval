import { Trash2 } from 'lucide-react';
import type { CollectionController } from '../../hooks/useCollection';
import { errorMessage } from '../../lib/format';
import { UploadPanel } from '../upload/UploadPanel';
import { ImageDetail } from '../gallery/ImageDetail';
import { Modal } from '../ui/Modal';
import { ErrorNotice, Spinner } from '../ui/Feedback';

function UploadDialog({ model }: Readonly<{ model: CollectionController }>) {
  const { uploadOpen, upload, system, setUploadOpen } = model;
  if (!uploadOpen) return null;
  return (
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
  );
}

function DetailDialog({ model }: Readonly<{ model: CollectionController }>) {
  const {
    detailImage,
    confirmation,
    confidence,
    currentSearch,
    retryIndexing,
    processing,
    deletion,
    setDetailImage,
    setConfirmation,
  } = model;
  if (!detailImage || confirmation) return null;
  return (
    <ImageDetail
      image={detailImage}
      confidence={confidence}
      selected={currentSearch?.categories ?? []}
      onClose={() => setDetailImage(null)}
      onDelete={(image) => {
        deletion.reset();
        setConfirmation({ image });
      }}
      onRetry={(image) => retryIndexing.mutate(image)}
      retrying={retryIndexing.isPending || processing}
      retryError={retryIndexing.isError ? errorMessage(retryIndexing.error) : undefined}
    />
  );
}

function DeleteConfirmation({ model }: Readonly<{ model: CollectionController }>) {
  const { confirmation, deletion, setConfirmation } = model;
  if (!confirmation) return null;
  return (
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
  );
}

export function CollectionDialogs({ model }: Readonly<{ model: CollectionController }>) {
  return (
    <>
      <UploadDialog model={model} />
      <DetailDialog model={model} />
      <DeleteConfirmation model={model} />
    </>
  );
}

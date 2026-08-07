import {
  useCallback,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { MediaAttachmentRef } from '@piwin/contracts';
import { resolveMediaPreviewUrl } from './media-utils';
import { IconClose } from './shell-icons';

function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? 'attachment';
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

function isVideoMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('video/');
}

/**
 * Fullscreen lightbox for media thumbnails. Portaled to document.body so it is
 * not clipped by transcript overflow / collapsed message masks, and so click
 * handlers on parent collapsible bubbles never receive the open/close events.
 */
function MediaLightbox(props: {
  open: boolean;
  url: string;
  label: string;
  onClose: () => void;
}): ReactElement | null {
  const titleId = useId();

  const { open, onClose } = props;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="media-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="media-lightbox"
      onClick={(event) => {
        // Portals still bubble through the React tree; stop before parent
        // collapsible message handlers see the click.
        event.stopPropagation();
        onClose();
      }}
      onMouseDown={(event) => {
        // Keep parent collapsible / message click handlers from seeing this.
        event.stopPropagation();
      }}
    >
      <div
        className="media-lightbox-stage"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span id={titleId} className="media-lightbox-sr-only">
          {props.label}
        </span>
        <button
          type="button"
          className="media-lightbox-close"
          aria-label="Close image preview"
          data-testid="media-lightbox-close"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <IconClose width={18} height={18} />
        </button>
        <img
          className="media-lightbox-image"
          src={props.url}
          alt={props.label}
          data-testid="media-lightbox-image"
        />
      </div>
    </div>,
    document.body,
  );
}

export function MediaPreview(props: {
  attachment: MediaAttachmentRef;
  previewUrl?: string;
  compact?: boolean;
}): ReactElement {
  const [url, setUrl] = useState<string | null>(props.previewUrl ?? null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const fileLabel = fileNameFromPath(props.attachment.path);
  const canOpenLightbox = Boolean(url) && !loadFailed && isImageMimeType(props.attachment.mimeType);

  useEffect(() => {
    setLoadFailed(false);
    setLightboxOpen(false);
    if (props.previewUrl) {
      setUrl(props.previewUrl);
      return;
    }
    let cancelled = false;
    void resolveMediaPreviewUrl(props.attachment.path).then((resolved) => {
      if (!cancelled) {
        setUrl(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.attachment.path, props.previewUrl]);

  function openLightbox(event: MouseEvent | KeyboardEvent): void {
    if (!canOpenLightbox) {
      return;
    }
    // User message bubbles collapse/expand on click; stop that when opening preview.
    event.preventDefault();
    event.stopPropagation();
    setLightboxOpen(true);
  }

  const closeLightbox = useCallback((): void => {
    setLightboxOpen(false);
  }, []);

  if (!url || loadFailed) {
    return (
      <div className={props.compact ? 'media-chip-fallback' : 'media-preview-fallback'}>
        {props.attachment.mimeType} · {props.attachment.byteSize}B
        {loadFailed ? ' · preview failed' : ''}
      </div>
    );
  }

  if (isVideoMimeType(props.attachment.mimeType)) {
    return (
      <video
        className={props.compact ? 'media-chip-video' : 'media-preview-video'}
        src={url}
        controls
        preload="metadata"
        playsInline
        aria-label={fileLabel}
        onError={() => setLoadFailed(true)}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        className={props.compact ? 'media-chip-thumb-button' : 'media-preview-image-button'}
        onClick={openLightbox}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={`Preview ${fileLabel}`}
        data-testid="media-preview-open"
      >
        <img
          className={props.compact ? 'media-chip-thumb' : 'media-preview-image'}
          src={url}
          alt={fileLabel}
          draggable={false}
          onError={() => setLoadFailed(true)}
        />
      </button>
      {lightboxOpen ? (
        <MediaLightbox open={lightboxOpen} url={url} label={fileLabel} onClose={closeLightbox} />
      ) : null}
    </>
  );
}

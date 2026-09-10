import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { contentKindForMimeType, type MediaAttachmentRef } from '@piwin/contracts';
import { useMediaPreviewRead } from './media-preview-read-context';
import { MediaImageContextMenu } from './media-image-context-menu';
import { buildMediaImageTarget } from './media-image-target';
import { saveMediaImageAs } from './media-image-actions';
import { copyImageToClipboard } from './copy-image-to-clipboard';
import { useLocalFileActions } from './local-file-actions-context';
import {
  mediaPreviewAssetId,
  resolveTranscriptPreviewUrls,
  type MediaPreviewReader,
} from './transcript-media-preview';
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconDocument,
  IconDownload,
  IconExpand,
} from './shell-icons';

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
 * Shared with the right-panel media document viewer (ADR 0052).
 */
export function MediaLightbox(props: {
  open: boolean;
  url: string;
  label: string;
  onClose: () => void;
  imageMenu?: ((image: ReactElement) => ReactElement) | undefined;
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
      onContextMenu={(event) => {
        // Portaled DOM is still a React child of the transcript bubble.
        // Stop so the message menu does not steal the image right-click.
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
        {(() => {
          const image = (
            <div className="media-lightbox-image-hit">
              <img
                className="media-lightbox-image"
                src={props.url}
                alt={props.label}
                data-testid="media-lightbox-image"
              />
            </div>
          );
          return props.imageMenu ? props.imageMenu(image) : image;
        })()}
      </div>
    </div>,
    document.body,
  );
}

export function MediaPreview(props: {
  attachment: MediaAttachmentRef;
  previewUrl?: string | undefined;
  lightboxUrl?: string | undefined;
  compact?: boolean | undefined;
  hero?: boolean | undefined;
  role?: 'user' | 'assistant' | 'system' | 'tool' | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
  /** Test override; production bubbles read session identity from context. */
  sessionId?: string | undefined;
  readMedia?: MediaPreviewReader | undefined;
}): ReactElement {
  const previewRead = useMediaPreviewRead();
  const sessionId = props.sessionId ?? previewRead.sessionId;
  const readMedia = props.readMedia ?? previewRead.readMedia;
  const localFileActions = useLocalFileActions();
  const [thumbUrl, setThumbUrl] = useState<string | null>(props.previewUrl ?? null);
  const [fullUrl, setFullUrl] = useState<string | null>(
    props.lightboxUrl ?? props.previewUrl ?? null,
  );
  const [mediaLoading, setMediaLoading] = useState(
    !props.previewUrl && !props.lightboxUrl,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isChinese = props.locale !== 'en';
  const fileLabel = props.attachment.name?.trim() || fileNameFromPath(props.attachment.path);
  const contentKind =
    props.attachment.contentKind ?? contentKindForMimeType(props.attachment.mimeType);
  const isFileCard = contentKind === 'text' || contentKind === 'document';
  const isVideo = isVideoMimeType(props.attachment.mimeType);
  const isAssistant = props.role === 'assistant' || props.hero === true;
  const canOpenLightbox =
    Boolean(fullUrl) &&
    Boolean(thumbUrl) &&
    !loadFailed &&
    !isFileCard &&
    isImageMimeType(props.attachment.mimeType);

  useEffect(() => {
    setLoadFailed(false);
    setLightboxOpen(false);
    if (isFileCard) {
      setMediaLoading(false);
      setThumbUrl(null);
      setFullUrl(null);
      return;
    }
    if (props.previewUrl) {
      setMediaLoading(false);
      setThumbUrl(props.previewUrl);
      setFullUrl(props.lightboxUrl ?? props.previewUrl);
      return;
    }
    // Composer chip still encoding: do not resolve pending:// and do not
    // put the original File URL on the 48px <img>.
    if (props.lightboxUrl) {
      setMediaLoading(false);
      setThumbUrl(null);
      setFullUrl(props.lightboxUrl);
      return;
    }
    setMediaLoading(true);
    let cancelled = false;
    let ownedThumb: string | null = null;
    const assetId = mediaPreviewAssetId(props.attachment.path, props.attachment.id);
    void (async () => {
      const resolved = await resolveTranscriptPreviewUrls({
        path: props.attachment.path,
        assetId,
        sessionId,
        isVideo,
        readMedia,
        mimeType: props.attachment.mimeType,
      });
      if (cancelled) {
        if (resolved.ownedThumb) {
          URL.revokeObjectURL(resolved.ownedThumb);
        }
        return;
      }
      setFullUrl(resolved.fullUrl);
      setThumbUrl(resolved.thumbUrl);
      setLoadFailed(false);
      setMediaLoading(false);
      ownedThumb = resolved.ownedThumb;
    })();
    return () => {
      cancelled = true;
      if (ownedThumb) {
        URL.revokeObjectURL(ownedThumb);
      }
    };
  }, [
    isFileCard,
    isVideo,
    props.attachment.id,
    props.attachment.mimeType,
    props.attachment.path,
    props.lightboxUrl,
    props.previewUrl,
    readMedia,
    sessionId,
  ]);

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

  async function handleCopy(event: MouseEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const targetUrl = fullUrl ?? thumbUrl;
    if (!targetUrl) return;
    const ok = await copyImageToClipboard(targetUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDownload(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const targetUrl = fullUrl ?? thumbUrl;
    void saveMediaImageAs({
      fileName: fileLabel,
      ...(targetUrl ? { srcUrl: targetUrl } : {}),
      ...(props.attachment.path ? { absolutePath: props.attachment.path } : {}),
      ...(localFileActions?.saveAs ? { saveLocalPath: localFileActions.saveAs } : {}),
    });
  }

  const imageTarget = useMemo(
    () =>
      buildMediaImageTarget({
        attachment: props.attachment,
        sessionId,
        srcUrl: fullUrl,
      }),
    [fullUrl, props.attachment, sessionId],
  );

  if (isFileCard) {
    return (
      <div
        className={props.compact ? 'media-chip-file' : 'media-preview-file'}
        data-testid="media-file-card"
        title={fileLabel}
      >
        <IconDocument width={props.compact ? 18 : 22} height={props.compact ? 18 : 22} />
        <span className="media-file-card-copy">
          <span className="media-file-card-name">{fileLabel}</span>
          <span className="media-file-card-meta">
            {props.attachment.mimeType} · {props.attachment.byteSize}B
          </span>
        </span>
      </div>
    );
  }

  if (mediaLoading) {
    return (
      <span
        className={props.hero ? 'media-preview-loading is-hero' : 'media-preview-loading'}
        data-media-preview-loading="true"
        data-testid="media-preview-loading"
        aria-hidden="true"
      />
    );
  }

  if (!thumbUrl || loadFailed) {
    const failedSuffix = loadFailed
      ? isChinese
        ? ' · 无法预览'
        : ' · preview unavailable'
      : '';
    return (
      <div className={props.compact ? 'media-chip-fallback' : 'media-preview-fallback'}>
        {props.attachment.mimeType} · {props.attachment.byteSize}B
        {failedSuffix}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className={props.compact ? 'media-chip-video-container' : 'media-preview-video-container'}>
        <video
          key={thumbUrl}
          className={
            props.compact
              ? 'media-chip-video'
              : props.hero
                ? 'media-preview-video is-hero'
                : 'media-preview-video'
          }
          src={thumbUrl}
          controls
          preload="metadata"
          playsInline
          aria-label={fileLabel}
          onError={(event) => {
            if (event.currentTarget.getAttribute('src') !== thumbUrl) {
              return;
            }
            setLoadFailed(true);
          }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        />
      </div>
    );
  }

  const showToolbar = !props.compact && isAssistant && !loadFailed && Boolean(thumbUrl);

  return (
    <>
      <MediaImageContextMenu
        target={imageTarget}
        onOpen={() => {
          if (canOpenLightbox) {
            setLightboxOpen(true);
          }
        }}
      >
        <div
          className={
            props.compact
              ? 'media-chip-container'
              : `media-preview-container${props.hero ? ' is-hero' : ''}`
          }
          data-testid="media-preview-container"
        >
          <button
            type="button"
            className={
              props.compact
                ? 'media-chip-thumb-button'
                : `media-preview-image-button${props.hero ? ' is-hero' : ''}`
            }
            onClick={openLightbox}
            onMouseDown={(event) => event.stopPropagation()}
            aria-label={`Preview ${fileLabel}`}
            data-testid="media-preview-open"
          >
            <img
              className={
                props.compact
                  ? 'media-chip-thumb'
                  : `media-preview-image${props.hero ? ' is-hero' : ''}`
              }
              src={thumbUrl}
              alt={fileLabel}
              decoding="async"
              draggable={false}
              onError={() => setLoadFailed(true)}
            />
          </button>

          {showToolbar ? (
            <div
              className="media-preview-toolbar"
              role="toolbar"
              aria-label={isChinese ? '图片操作' : 'Media actions'}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`media-preview-toolbar-btn${copied ? ' copied' : ''}`}
                title={copied ? (isChinese ? '已复制' : 'Copied!') : isChinese ? '复制图片' : 'Copy image'}
                aria-label={isChinese ? '复制图片' : 'Copy image'}
                onClick={handleCopy}
              >
                {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
              </button>
              <button
                type="button"
                className="media-preview-toolbar-btn"
                title={isChinese ? '下载图片' : 'Download image'}
                aria-label={isChinese ? '下载图片' : 'Download image'}
                onClick={handleDownload}
              >
                <IconDownload width={14} height={14} />
              </button>
              <button
                type="button"
                className="media-preview-toolbar-btn"
                title={isChinese ? '全屏查看' : 'Fullscreen preview'}
                aria-label={isChinese ? '全屏查看' : 'Fullscreen preview'}
                onClick={openLightbox}
              >
                <IconExpand width={14} height={14} />
              </button>
            </div>
          ) : null}
        </div>
      </MediaImageContextMenu>
      {lightboxOpen && fullUrl ? (
        <MediaLightbox
          open={lightboxOpen}
          url={fullUrl}
          label={fileLabel}
          onClose={closeLightbox}
          imageMenu={(image) => (
            <MediaImageContextMenu
              target={buildMediaImageTarget({
                attachment: props.attachment,
                sessionId,
                srcUrl: fullUrl,
                inLightbox: true,
              })}
            >
              {image}
            </MediaImageContextMenu>
          )}
        />
      ) : null}
    </>
  );
}

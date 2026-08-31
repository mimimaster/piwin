/**
 * Right-panel media viewer for Doc Preview (ADR 0052 Slice 1).
 *
 * Renders session media vault assets (generated images, videos) that the text
 * pipeline used to reject as `outside-project`. Local vault paths resolve
 * through the Tauri asset protocol; remote structured media targets fetch
 * bytes via `media/read` and pass a data URL.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconClose } from './shell-icons';
import { MediaLightbox } from './MediaPreview';
import { PreviewUnavailable } from './PreviewUnavailable';
import { resolveMediaPreviewUrl } from './media-utils';
import { mediaKindForPath } from './media-path';
import { provenanceLabel, type ActiveDocumentMedia } from './active-document';
import type { DesktopLocale } from './desktop-locale';

const MAX_ZOOM_SCALE = 8;
const MIN_ZOOM_SCALE = 1;
const WHEEL_ZOOM_STEP = 1.15;

function clampScale(value: number): number {
  return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, value));
}

function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path;
}

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

/**
 * Fit-to-panel image with wheel zoom, drag pan (when zoomed in), and
 * double-click reset. Native non-passive wheel listener so the panel never
 * scrolls the transcript underneath while zooming.
 */
function ZoomableImage(props: {
  url: string;
  label: string;
  onOpenLightbox: () => void;
  onZoomChange: (scale: number) => void;
}): ReactElement {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const resetView = useCallback((): void => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const { onZoomChange } = props;
  useEffect(() => {
    onZoomChange(scale);
  }, [onZoomChange, scale]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      setScale((current) => clampScale(current * (event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP)));
    };
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      stage.removeEventListener('wheel', handleWheel);
    };
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLImageElement>): void {
    if (scale <= 1 || dragStateRef.current) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLImageElement>): void {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLImageElement>): void {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
  }

  function handleImageClick(): void {
    if (scale <= 1) {
      props.onOpenLightbox();
    }
  }

  return (
    <div className="media-doc-stage" ref={stageRef} data-testid="media-doc-stage">
      <img
        className="media-doc-image"
        src={props.url}
        alt={props.label}
        draggable={false}
        data-testid="media-doc-image"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? 'grab' : 'zoom-in',
        }}
        onClick={handleImageClick}
        onDoubleClick={(event) => {
          event.stopPropagation();
          resetView();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className="media-doc-zoom-hud" data-testid="media-doc-zoom-hud">
        <span>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="media-doc-zoom-reset"
          onClick={resetView}
          disabled={scale <= 1}
          data-testid="media-doc-zoom-reset"
        >
          重置
        </button>
      </div>
    </div>
  );
}

export type MediaDocPreviewProps = {
  title?: string | undefined;
  displayRef?: string | undefined;
  media: ActiveDocumentMedia;
  onClose?: (() => void) | undefined;
  locale?: DesktopLocale | undefined;
};

export function MediaDocPreview({
  title,
  displayRef,
  media,
  onClose,
  locale = 'zh-CN',
}: MediaDocPreviewProps): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [resolutionFailed, setResolutionFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const kind = mediaKindForPath(media.path);
  const fileLabel = title?.trim() || fileNameFromPath(media.path);

  useEffect(() => {
    let cancelled = false;
    setResolutionFailed(false);
    setUrl(null);
    // Remote media targets carry pre-fetched bytes (media/read); local vault
    // paths resolve lazily through the Tauri asset protocol.
    if (media.dataUrl) {
      setUrl(media.dataUrl);
      return () => {
        cancelled = true;
      };
    }
    void resolveMediaPreviewUrl(media.path).then((resolved) => {
      if (!cancelled) {
        setUrl(resolved);
        if (!resolved) {
          setResolutionFailed(true);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [media.dataUrl, media.path]);

  const closeLightbox = useCallback((): void => {
    setLightboxOpen(false);
  }, []);

  const handleZoomChange = useCallback((scale: number): void => {
    setZoomScale(scale);
  }, []);

  const showUnavailable = resolutionFailed || url === null;
  const isVideo = kind === 'video';

  return (
    <div className="doc-preview-panel" data-testid="media-doc-preview-panel">
      <header className="doc-preview-header">
        <div className="doc-preview-title-group">
          <div className="doc-preview-title-stack">
            <h2 className="doc-preview-title">{fileLabel}</h2>
            <div className="doc-preview-meta" data-testid="media-doc-meta">
              {displayRef && displayRef !== fileLabel ? (
                <span className="doc-preview-chip" title={displayRef}>
                  {fileNameFromPath(displayRef)}
                </span>
              ) : null}
              <span className="doc-preview-chip" data-testid="media-doc-provenance">
                {provenanceLabel('session-media', locale === 'en' ? 'en' : 'zh-CN')}
              </span>
            </div>
          </div>
        </div>
        <div className="doc-preview-actions">
          {onClose ? (
            <IconButton
              label={locale === 'zh-CN' ? '返回会话' : 'Back to conversation'}
              title={locale === 'zh-CN' ? '返回会话' : 'Back to conversation'}
              data-testid="media-doc-close"
              onClick={onClose}
            >
              <IconClose width={14} height={14} />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div className="doc-preview-container">
        <div className="doc-preview-body media-doc-body">
          {showUnavailable ? (
            <PreviewUnavailable
              reason="media-unavailable"
              locale={locale}
              fileName={fileLabel}
              testId="media-doc-state-unavailable"
            />
          ) : isVideo ? (
            <video
              className="media-doc-video"
              src={url ?? undefined}
              controls
              preload="metadata"
              playsInline
              data-testid="media-doc-video"
            />
          ) : (
            <ZoomableImage
              url={url ?? ''}
              label={fileLabel}
              onOpenLightbox={() => setLightboxOpen(true)}
              onZoomChange={handleZoomChange}
            />
          )}
        </div>
      </div>

      {lightboxOpen && url ? (
        <MediaLightbox open={lightboxOpen} url={url} label={fileLabel} onClose={closeLightbox} />
      ) : null}
      <span className="media-doc-zoom-live" data-testid="media-doc-zoom-live" aria-live="polite">
        {zoomScale > 1 ? `${Math.round(zoomScale * 100)}%` : ''}
      </span>
    </div>
  );
}

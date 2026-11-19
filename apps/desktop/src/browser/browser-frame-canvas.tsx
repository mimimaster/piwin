/**
 * Single-instance canvas host for live Browser Mirror frames.
 *
 * Drawing an `ImageBitmap` directly to an opaque 2D canvas and immediately
 * closing the superseded bitmap avoids WebKit's `WebCore::MemoryCache` URL
 * retention that retains decoded IOSurfaces for `blob:` / custom-scheme `<img>`
 * frames across long sessions.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type WheelEvent,
} from 'react';

export function canRenderBrowserFrameCanvas(): boolean {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return false;
  }
  try {
    return document.createElement('canvas').getContext('2d', { alpha: false }) !== null;
  } catch {
    return false;
  }
}

export type BrowserFrameCanvasProps = {
  bitmap: ImageBitmap;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  testId?: string | undefined;
  stale?: boolean | undefined;
  ariaLabel?: string | undefined;
  elementRef?: { current: HTMLElement | null } | undefined;
  onPointerDown?: ((event: PointerEvent<HTMLCanvasElement>) => void) | undefined;
  onPointerMove?: ((event: PointerEvent<HTMLCanvasElement>) => void) | undefined;
  onPointerUp?: ((event: PointerEvent<HTMLCanvasElement>) => void) | undefined;
  onPointerCancel?: ((event: PointerEvent<HTMLCanvasElement>) => void) | undefined;
  onClick?: ((event: MouseEvent<HTMLCanvasElement>) => void) | undefined;
  onWheel?: ((event: WheelEvent<HTMLCanvasElement>) => void) | undefined;
  onContextMenu?: ((event: MouseEvent<HTMLCanvasElement>) => void) | undefined;
};

export function BrowserFrameCanvas(props: BrowserFrameCanvasProps): ReactElement {
  const localRef = useRef<HTMLCanvasElement | null>(null);
  const { bitmap, elementRef } = props;

  useLayoutEffect(() => {
    const canvas = localRef.current;
    if (canvas === null || bitmap.width <= 0 || bitmap.height <= 0) {
      return;
    }
    if (canvas.width !== bitmap.width) {
      canvas.width = bitmap.width;
    }
    if (canvas.height !== bitmap.height) {
      canvas.height = bitmap.height;
    }
    const context = canvas.getContext('2d', { alpha: false });
    if (context === null) {
      return;
    }
    try {
      context.drawImage(bitmap, 0, 0);
    } catch {
      // Ignore if the ImageBitmap was closed synchronously between dispatch and commit.
    }
  }, [bitmap]);

  useEffect(() => {
    return () => {
      const canvas = localRef.current;
      if (canvas !== null) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (elementRef !== undefined) {
        elementRef.current = null;
      }
    };
  }, [elementRef]);

  return (
    <canvas
      ref={(node) => {
        localRef.current = node;
        if (elementRef !== undefined) {
          elementRef.current = node;
        }
      }}
      className={props.className}
      data-testid={props.testId}
      data-stale={props.stale === undefined ? undefined : props.stale ? 'true' : 'false'}
      aria-label={props.ariaLabel}
      role={props.ariaLabel ? 'img' : undefined}
      style={props.style}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onClick={props.onClick}
      onWheel={props.onWheel}
      onContextMenu={props.onContextMenu}
    />
  );
}

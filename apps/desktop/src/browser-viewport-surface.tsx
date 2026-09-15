/**
 * Page viewport surface: the mirrored frame, IME sink, and pick highlight.
 * Pointer/IME handlers stay in the panel (Slice C owns the input rewrite).
 */
import type {
  KeyboardEvent,
  PointerEvent,
  ReactElement,
  RefObject,
  WheelEvent,
} from 'react';
import { IconBrowser } from './shell-icons';
import type { BrowserHighlightBox } from './browser-session-lease';
import type { BrowserDisplayBox, BrowserDisplayZoom } from './browser-display-box';

export type BrowserViewportSurfaceProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  imeRef: RefObject<HTMLTextAreaElement | null>;
  frameSrc: string;
  frameAlt: string;
  starting: string;
  pickMode: boolean;
  interactEnabled: boolean;
  runtimeInteractEnabled: boolean;
  displayBox: BrowserDisplayBox;
  zoom: BrowserDisplayZoom;
  overlay: BrowserHighlightBox | null;
  overlayOffsetX: number;
  overlayOffsetY: number;
  onPointerDown: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLImageElement>) => void;
  onClick: (event: import('react').MouseEvent<HTMLImageElement>) => void;
  onWheel: (event: WheelEvent<HTMLImageElement>) => void;
  onImeKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd: (event: { data: string; currentTarget: HTMLTextAreaElement }) => void;
  onPaste: (event: { preventDefault: () => void; clipboardData: DataTransfer }) => void;
  children?: ReactElement | null;
};

export function BrowserViewportSurface(props: BrowserViewportSurfaceProps): ReactElement {
  const displayStyle =
    props.displayBox.width > 0 && props.displayBox.height > 0
      ? { width: `${String(props.displayBox.width)}px`, height: `${String(props.displayBox.height)}px` }
      : undefined;

  return (
    <div
      className="browser-session-frame-container"
      ref={props.containerRef}
      data-testid="browser-session-frame-container"
      data-zoom={props.zoom}
    >
      {props.frameSrc ? (
        <img
          ref={props.imgRef}
          className={`browser-session-frame${props.pickMode ? ' pick-mode' : ''}${
            props.runtimeInteractEnabled ? '' : ' stale'
          }`}
          data-testid="browser-session-frame"
          data-stale={props.runtimeInteractEnabled ? 'false' : 'true'}
          src={props.frameSrc}
          alt={props.frameAlt}
          style={displayStyle}
          onPointerDown={props.onPointerDown}
          onPointerMove={props.onPointerMove}
          onPointerUp={props.onPointerUp}
          onPointerCancel={props.onPointerCancel}
          onClick={props.onClick}
          onWheel={props.onWheel}
          onContextMenu={(event) => event.preventDefault()}
          draggable={false}
        />
      ) : (
        <div className="browser-session-frame-placeholder">
          <IconBrowser width={32} height={32} />
          <span>{props.starting}</span>
        </div>
      )}
      {!props.pickMode && props.interactEnabled ? (
        <textarea
          ref={props.imeRef}
          className="browser-session-ime"
          data-testid="browser-session-ime"
          aria-label="Browser keyboard"
          onKeyDown={props.onImeKey}
          onKeyUp={props.onImeKey}
          onCompositionEnd={(event) => {
            props.onCompositionEnd({ data: event.data, currentTarget: event.currentTarget });
          }}
          onPaste={(event) => {
            props.onPaste(event);
          }}
        />
      ) : null}
      {props.children}
      {props.overlay ? (
        <div
          className="browser-session-highlight"
          data-testid="browser-session-highlight"
          style={{
            position: 'absolute',
            left: `${String(props.overlay.x + props.overlayOffsetX)}px`,
            top: `${String(props.overlay.y + props.overlayOffsetY)}px`,
            width: `${String(props.overlay.width)}px`,
            height: `${String(props.overlay.height)}px`,
          }}
        />
      ) : null}
    </div>
  );
}

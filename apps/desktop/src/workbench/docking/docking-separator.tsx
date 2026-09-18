import type { ReactElement } from 'react';
import type { StageSeparatorRect } from './geometry.js';

export type DockingSeparatorProps = {
  separator: StageSeparatorRect;
  locale: 'zh-CN' | 'en';
  onRatio: (ratio: number) => void;
};

/**
 * Split handle. Grabs the pointer directly: the new weight is the pointer's
 * position inside the split rect, so the handle never drifts when the split is
 * re-allocated mid-drag. Clamping stays in `setSplitRatio`.
 */
export function DockingSeparator(props: DockingSeparatorProps): ReactElement {
  const { separator } = props;
  const isRow = separator.orientation === 'row';
  return (
    <button
      type="button"
      className={`conversation-pane-separator is-${isRow ? 'vertical' : 'horizontal'} docking-separator`}
      style={
        isRow
          ? {
              left: `${String(separator.boundary)}px`,
              top: `${String(separator.rect.top)}px`,
              height: `${String(separator.rect.height)}px`,
            }
          : {
              top: `${String(separator.boundary)}px`,
              left: `${String(separator.rect.left)}px`,
              width: `${String(separator.rect.width)}px`,
            }
      }
      aria-label={props.locale === 'zh-CN' ? '调整分屏' : 'Resize split'}
      onPointerDown={(event) => {
        const host = event.currentTarget.offsetParent;
        if (!(host instanceof HTMLElement)) return;
        const hostRect = host.getBoundingClientRect();
        const move = (moveEvent: PointerEvent): void => {
          const ratio = isRow
            ? (moveEvent.clientX - hostRect.left - separator.rect.left) / separator.rect.width
            : (moveEvent.clientY - hostRect.top - separator.rect.top) / separator.rect.height;
          props.onRatio(ratio);
        };
        const up = (): void => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
        event.preventDefault();
        // Capture keeps the drag alive when the pointer crosses a pane's
        // iframe (artifacts, browser), which would otherwise swallow moves.
        event.currentTarget.setPointerCapture(event.pointerId);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
}

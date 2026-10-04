import type { CSSProperties, ReactElement } from 'react';
import type { Point, Rect } from './drag-hit-test.js';
import type { DragPreview } from './use-docking-drag.js';

function styleFor(rect: Rect): CSSProperties {
  return {
    left: `${String(rect.left)}px`,
    top: `${String(rect.top)}px`,
    width: `${String(rect.width)}px`,
    height: `${String(rect.height)}px`,
  };
}

export function DockingDragOverlay(props: {
  preview: DragPreview;
  stageRect: Rect;
  point: Point;
  sourceLabel: string | null;
}): ReactElement {
  const announcement = props.preview.ok ? props.preview.label : props.preview.message;
  const ghostLeft = Math.min(
    Math.max(8, props.point.x + 14),
    Math.max(8, props.stageRect.width - 248),
  );
  const ghostTop = Math.min(
    Math.max(8, props.point.y + 14),
    Math.max(8, props.stageRect.height - 56),
  );
  return (
    <>
      <div className="docking-drag-overlay" aria-hidden="true" style={styleFor(props.stageRect)}>
        <div className="docking-drag-scrim" />
        {props.preview.highlight.map((highlight, index) => (
          <div
            key={`${highlight.kind}-${String(index)}`}
            className={`docking-drop-preview is-${highlight.kind}${highlight.edge ? ` is-edge-${highlight.edge}` : ''}`}
            style={styleFor(highlight)}
          >
            {index === 0 && props.preview.ok && props.preview.label ? (
              <span className="docking-drop-preview-label">{props.preview.label}</span>
            ) : null}
          </div>
        ))}
        {props.sourceLabel ? (
          <div className="docking-drag-ghost" style={{ left: ghostLeft, top: ghostTop }}>
            {props.sourceLabel}
          </div>
        ) : null}
        {!props.preview.ok && props.preview.message ? (
          <div className="docking-drop-label is-rejected">{props.preview.message}</div>
        ) : null}
      </div>
      {announcement ? (
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
      ) : null}
    </>
  );
}

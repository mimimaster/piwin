import type { CSSProperties, ReactElement } from 'react';
import type { DragPreview } from './use-docking-drag.js';
import type { Rect } from './drag-hit-test.js';

function styleFor(rect: Rect): CSSProperties {
  return { left: `${String(rect.left)}px`, top: `${String(rect.top)}px`, width: `${String(rect.width)}px`, height: `${String(rect.height)}px` };
}

export function DockingDragOverlay(props: { preview: DragPreview }): ReactElement {
  return (
    <div className="docking-drag-overlay" aria-hidden="true">
      {props.preview.highlight.map((highlight, index) => (
        <div
          key={`${highlight.kind}-${String(index)}`}
          className={`docking-drop-preview is-${highlight.kind}${highlight.edge ? ` is-edge-${highlight.edge}` : ''}`}
          style={styleFor(highlight)}
        />
      ))}
      {props.preview.label || props.preview.message ? (
        <div className={`docking-drop-label${props.preview.ok ? '' : ' is-rejected'}`} role="status">
          {props.preview.ok ? props.preview.label : props.preview.message}
        </div>
      ) : null}
    </div>
  );
}

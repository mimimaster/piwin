import type { ReactElement } from 'react';
import type { SessionOutlineNode } from '@piwin/contracts';
import { Popover } from '@piwin/ui-kit';
import { messageAnchorId } from './transcript-outline';

export type TranscriptOutlinePopoverProps = {
  outline: SessionOutlineNode[];
  trigger: ReactElement;
};

export function TranscriptOutlinePopover(
  props: TranscriptOutlinePopoverProps,
): ReactElement {
  return (
    <Popover
      trigger={props.trigger}
      testId="transcript-outline-popover"
      contentClassName="transcript-outline-popover"
    >
      <div className="transcript-outline-list">
        <div className="plus-menu-caption muted">Session outline</div>
        {props.outline.length === 0 ? (
          <div className="muted">No outline yet</div>
        ) : (
          props.outline.map((node) => (
            <button
              key={node.id}
              type="button"
              className="plus-menu-item"
              data-testid="outline-item"
              onClick={() => {
                const element = document.getElementById(messageAnchorId(node.id));
                element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span className="muted" style={{ fontSize: 11 }}>
                {node.role}
              </span>
              <span className="plus-menu-label">{node.preview || '(empty)'}</span>
            </button>
          ))
        )}
      </div>
    </Popover>
  );
}

import type { ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import { inkLineNodeClass, toolStatusToNodeStatus } from './session-node-status.js';

/**
 * `data-kind` carries the shared six-state vocabulary (session-node-status.ts)
 * so this dot and the sidebar's InkLineNode are provably the same language,
 * not just coincidentally matching colors. Visual treatment (size, color,
 * breath) stays on the existing `.tool-status-dot`/`.status-*` classes —
 * unchanged, since it already renders identically to the shared node states.
 */
export function ToolStatusDot(props: {
  status: ToolCardUi['status'];
  /** Prototype ink-line node (`.node` / `.node.sm`). */
  inkLine?: boolean | undefined;
  small?: boolean | undefined;
}): ReactElement {
  const kind = toolStatusToNodeStatus(props.status);
  const protoClass = inkLineNodeClass(kind);
  if (props.inkLine === true) {
    return (
      <span
        className={`node${props.small === true ? ' sm' : ''}${protoClass ? ` ${protoClass}` : ''} tool-status-dot status-${props.status}`}
        data-kind={kind}
        title={props.status}
        aria-label={props.status}
      />
    );
  }
  return (
    <span
      className={`tool-status-dot status-${props.status}`}
      data-kind={kind}
      title={props.status}
      aria-label={props.status}
    />
  );
}

/**
 * Shared six-state status node (Inkstone increment 7, `08-motion-and-
 * components.md` §2 row 06). Renders the one node shape/color pair for a
 * `SessionNodeStatusKind`; callers own layout and placement.
 *
 * Five states are a filled or hollow circle; `waiting-you` is the only
 * rounded square in the entire vocabulary, so it reads as categorically
 * different at a glance rather than just "a different color dot."
 */
import type { ReactElement } from 'react';
import type { SessionNodeStatusKind } from './session-node-status';

export type InkLineNodeProps = {
  kind: SessionNodeStatusKind | 'pending';
  /** Accessible label; required since the node carries meaning, not decoration. */
  label: string;
  /** Compact matches the existing 6-7px tool/session dots; default is 8px. */
  size?: 'compact' | 'default';
};

export function InkLineNode(props: InkLineNodeProps): ReactElement {
  const size = props.size ?? 'default';
  return (
    <span
      className={`ink-line-node ink-line-node--${props.kind} ink-line-node--${size}`}
      data-testid="ink-line-node"
      data-kind={props.kind}
      role="status"
      aria-label={props.label}
      title={props.label}
    />
  );
}

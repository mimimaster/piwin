import type { ReactElement, ReactNode } from 'react';

export type EmptyStateProps = {
  title: string;
  description?: string;
  /** Optional illustration or icon node. */
  visual?: ReactNode;
  /** Primary call-to-action (button, link). */
  action?: ReactNode;
  testId?: string;
  children?: ReactNode;
};

/**
 * Shared empty-surface layout. Product CSS supplies visual tokens via class names.
 */
export function EmptyState(props: EmptyStateProps): ReactElement {
  return (
    <div className="empty-state" data-testid={props.testId ?? 'empty-state'}>
      {props.visual ? (
        <div className="empty-state-visual" aria-hidden>
          {props.visual}
        </div>
      ) : null}
      <h2 className="empty-state-title">{props.title}</h2>
      {props.description ? <p className="empty-state-copy muted">{props.description}</p> : null}
      {props.action ? <div className="empty-state-action">{props.action}</div> : null}
      {props.children}
    </div>
  );
}

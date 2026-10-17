/**
 * Live/attention mark for a sidebar session row's lead slot. When a session
 * has a status it takes the slot over from the kind mark (ring, draft,
 * worktree, agent logo), so one column down the sidebar answers "what needs
 * me" at a glance. Display only: the row itself opens the session, and
 * opening it is what clears an unread outcome.
 */
import type { ReactElement } from 'react';
import { IconCheck, IconClose } from './shell-icons';
import { InkLineNode } from './ink-line-node';
import type { SessionNodeStatusKind } from './session-node-status';

export type SessionStatusMarkLabels = {
  working: string;
  backendServiceActive: string;
  waitingOnYou: string;
  completed: string;
  failedAttention: string;
};

export function SessionStatusMark(props: {
  kind: SessionNodeStatusKind;
  labels: SessionStatusMarkLabels;
}): ReactElement | null {
  switch (props.kind) {
    case 'waiting-you':
      return (
        <span
          className="session-status-mark session-status-mark--waiting-you"
          data-testid="session-waiting-indicator"
        >
          <InkLineNode kind="waiting-you" label={props.labels.waitingOnYou} />
        </span>
      );
    case 'running':
      return (
        <span
          className="session-status-mark session-status-mark--running"
          data-testid="session-working-indicator"
          role="status"
          aria-label={props.labels.working}
          title={props.labels.working}
        />
      );
    case 'background':
      return (
        <span
          className="session-status-mark session-status-mark--service"
          data-testid="session-service-indicator"
          role="status"
          aria-label={props.labels.backendServiceActive}
          title={props.labels.backendServiceActive}
        >
          <span className="session-status-mark-dot" aria-hidden />
          <span className="session-status-mark-dot" aria-hidden />
          <span className="session-status-mark-dot" aria-hidden />
        </span>
      );
    case 'failed':
      return (
        <span
          className="session-status-mark session-status-mark--failed"
          data-testid="session-failed-indicator"
          role="img"
          aria-label={props.labels.failedAttention}
          title={props.labels.failedAttention}
        >
          <IconClose width={8} height={8} />
        </span>
      );
    case 'success':
      return (
        <span
          className="session-status-mark session-status-mark--success"
          data-testid="session-completed-indicator"
          role="img"
          aria-label={props.labels.completed}
          title={props.labels.completed}
        >
          <IconCheck width={9} height={9} />
        </span>
      );
    case 'pending':
      return null;
  }
}

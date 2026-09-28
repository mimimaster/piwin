import { useState, type ReactElement } from 'react';
import type { ModelRef, RunIdleLoopNotice } from '@piwin/contracts';
import { Button, IconButton, showErrorNotification, showSuccessNotification } from '@piwin/ui-kit';
import { IconClose, IconWarn } from './shell-icons';
import { presentRunIdleLoopCard } from './run-idle-loop-presentation.js';
import { useRunIdleLoopActions } from './run-idle-loop-context.js';

export type RunIdleLoopCardProps = {
  runId: string;
  notice: RunIdleLoopNotice;
  runEnded: boolean;
  model?: ModelRef | undefined;
  locale?: string | undefined;
};

/**
 * Detection-only idle-loop notice under a Run's response. It never offers to
 * stop the Run: stopping stays the user's normal stop control. Its one exit
 * is × (persisted by Host); recovery and Run end only change its state.
 */
export function RunIdleLoopCard(props: RunIdleLoopCardProps): ReactElement | null {
  const actions = useRunIdleLoopActions();
  const [copied, setCopied] = useState(false);
  if (props.notice.dismissed === true || actions?.isDismissed(props.runId) === true) {
    return null;
  }
  const view = presentRunIdleLoopCard({
    notice: props.notice,
    runEnded: props.runEnded,
    model: props.model,
    locale: props.locale,
  });

  const copyDiagnostics = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(view.diagnostics);
      setCopied(true);
      showSuccessNotification(view.copiedLabel);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      showErrorNotification(view.copyLabel);
    }
  };

  return (
    <div
      className={`turn-error-card run-idle-loop-card is-${view.variant}`}
      data-testid="run-idle-loop-card"
      data-variant={view.variant}
      role="status"
      aria-live={view.variant === 'looping' ? 'polite' : 'off'}
    >
      <div className="turn-error-card-inner">
        <div className="turn-error-header">
          <div className="turn-error-icon-badge run-idle-loop-badge" aria-hidden>
            <IconWarn width={14} height={14} />
          </div>
          <span className="turn-error-title">{view.title}</span>
          <span className="turn-error-category-tag run-idle-loop-tag" data-testid="run-idle-loop-tag">
            {view.tag}
          </span>
          {actions ? (
            <IconButton
              label={view.dismissLabel}
              size="sm"
              className="run-idle-loop-dismiss"
              data-testid="run-idle-loop-dismiss"
              onClick={() => actions.dismiss(props.runId)}
            >
              <IconClose width={14} height={14} />
            </IconButton>
          ) : null}
        </div>
        <p className="run-idle-loop-body">{view.body}</p>
        {view.calls.length > 0 ? (
          <div className="turn-error-detail run-idle-loop-calls" data-testid="run-idle-loop-calls">
            {view.calls.map((call) => (
              <div className="run-idle-loop-call" key={`${call.toolName}\u0000${call.preview}`}>
                <span className="run-idle-loop-call-tool">{call.toolName}</span>
                <span className="run-idle-loop-call-args">{call.preview || '{}'}</span>
                <span className="run-idle-loop-call-count">{view.countLabel(call.count)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="run-idle-loop-meta">{view.meta}</div>
        <div className="turn-error-actions">
          <Button
            variant="secondary"
            size="compact"
            data-testid="run-idle-loop-copy"
            onClick={() => void copyDiagnostics()}
          >
            {copied ? view.copiedLabel : view.copyLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

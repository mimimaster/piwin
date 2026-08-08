/**
 * Inline model question surface using the shared AgentInterruptionFrame.
 *
 * This is deliberately not a modal: the question is part of the active agent
 * turn, so it must remain visible next to the place where the user answers and
 * must not trap the user away from the run controls.
 *
 * Stop is intentionally NOT rendered here — the composer toolbar owns the
 * sole Stop control. Cancel dismisses the question only; it does not abort
 * the run.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { AgentInterruptionFrame } from './agent-interruption-frame';
import type { ExtensionUiRequestState } from './hooks/use-host-bootstrap';
import { useDesktopLocale } from './desktop-locale-context';
import { getBehaviorActivitySpec } from './behavior-activity.js';

export type ExtensionUiResolvePayload = {
  confirmed?: boolean;
  value?: string;
  cancelled?: boolean;
};

export type ExtensionUiPromptProps = {
  request: ExtensionUiRequestState | null;
  onResolve: (payload: ExtensionUiResolvePayload) => void;
};

export function ExtensionUiPrompt(props: ExtensionUiPromptProps): ReactElement | null {
  const request = props.request;
  if (!request) {
    return null;
  }
  return <ExtensionUiPromptInner request={request} onResolve={props.onResolve} />;
}

function ExtensionUiPromptInner({
  request,
  onResolve,
}: {
  request: ExtensionUiRequestState;
  onResolve: (payload: ExtensionUiResolvePayload) => void;
}): ReactElement {
  const { translator } = useDesktopLocale();
  const description =
    request.kind === 'input'
      ? translator.interruption.answerInComposer
      : request.message ?? undefined;

  return (
    <AgentInterruptionFrame
      tone="question"
      statusLabel={translator.interruption.agentWaiting}
      title={request.title}
      {...(description !== undefined ? { description } : {})}
      testId="extension-ui-prompt"
      activityId="ask"
      activityAnimation={getBehaviorActivitySpec('ask').animation}
      activityStatus="running"
    >
      {request.kind === 'select' ? (
        <div
          className="agent-interruption-choices"
          role="group"
          aria-label={request.title}
        >
          {(request.options ?? []).map((option, index) => (
            <button
              key={option}
              type="button"
              className="agent-interruption-choice"
              data-testid="extension-ui-option"
              onClick={() => onResolve({ value: option })}
            >
              <span className="agent-interruption-choice-badge">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="agent-interruption-choice-label">{option}</span>
            </button>
          ))}
        </div>
      ) : null}

      {request.kind === 'confirm' ? (
        <div className="agent-interruption-actions">
          <Button
            variant="secondary"
            data-testid="extension-ui-deny"
            onClick={() => onResolve({ confirmed: false })}
          >
            <span className="agent-interruption-choice-badge">B</span>
            <span>{translator.common.cancel}</span>
          </Button>
          <Button
            variant="primary"
            data-testid="extension-ui-allow"
            onClick={() => onResolve({ confirmed: true })}
          >
            <span className="agent-interruption-choice-badge">A</span>
            <span>{translator.interruption.continue}</span>
          </Button>
        </div>
      ) : null}

      {request.kind === 'select' || request.kind === 'confirm' ? (
        <div className="agent-interruption-footer">
          <Button
            variant="ghost"
            size="compact"
            data-testid="extension-ui-cancel"
            onClick={() => onResolve({ cancelled: true, confirmed: false })}
          >
            {translator.interruption.cancelQuestion}
          </Button>
        </div>
      ) : null}
    </AgentInterruptionFrame>
  );
}

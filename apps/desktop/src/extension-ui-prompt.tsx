import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { ExtensionUiRequestState } from './hooks/use-host-bootstrap';

export type ExtensionUiResolvePayload = {
  confirmed?: boolean;
  value?: string;
  cancelled?: boolean;
};

export type ExtensionUiPromptProps = {
  request: ExtensionUiRequestState | null;
  onResolve: (payload: ExtensionUiResolvePayload) => void;
  onAbort: () => void | Promise<void>;
};

/**
 * Inline model question surface attached to the Composer.
 *
 * This is deliberately not a modal: the question is part of the active agent
 * turn, so it must remain visible next to the place where the user answers and
 * must not trap the user away from the run controls.
 */
export function ExtensionUiPrompt(props: ExtensionUiPromptProps): ReactElement | null {
  const request = props.request;

  if (!request) {
    return null;
  }

  return (
    <section
      className="extension-ui-prompt"
      data-testid="extension-ui-prompt"
      aria-label="Agent question"
    >
      <div className="extension-ui-prompt-header">
        <div className="extension-ui-prompt-heading">
          <span className="extension-ui-prompt-eyebrow">Agent needs your input</span>
          <strong className="extension-ui-prompt-title">{request.title}</strong>
        </div>
        <span className="extension-ui-prompt-kind">{request.kind}</span>
      </div>

      {request.message ? (
        <p className="extension-ui-prompt-message">{request.message}</p>
      ) : null}

      {request.kind === 'select' ? (
        <div className="extension-ui-prompt-options" role="listbox" aria-label={request.title}>
          {(request.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              className="extension-ui-prompt-option"
              data-testid="extension-ui-option"
              role="option"
              onClick={() => props.onResolve({ value: option })}
            >
              <span>{option}</span>
              <span className="extension-ui-prompt-option-arrow" aria-hidden>
                Enter
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {request.kind === 'confirm' ? (
        <div className="extension-ui-prompt-actions">
          <Button data-testid="extension-ui-deny" onClick={() => props.onResolve({ confirmed: false })}>
            Deny
          </Button>
          <Button
            variant="primary"
            data-testid="extension-ui-allow"
            onClick={() => props.onResolve({ confirmed: true })}
          >
            Allow
          </Button>
        </div>
      ) : null}

      <div className="extension-ui-prompt-footer">
        <span className="extension-ui-prompt-hint">
          {request.kind === 'select'
            ? 'Choose an option to continue'
            : request.kind === 'input'
              ? 'Type your answer in the composer below'
              : 'The agent is waiting'}
        </span>
        <div className="extension-ui-prompt-footer-actions">
          <Button
            size="compact"
            data-testid="extension-ui-cancel"
            onClick={() => props.onResolve({ cancelled: true, confirmed: false })}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="compact"
            data-testid="extension-ui-stop"
            onClick={() => void props.onAbort()}
          >
            Stop run
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Hover action strip on chat messages — Cursor Agent pattern:
 * Copy always; Retry / Edit on last user message (or following assistant).
 */

import { useState, type ReactElement } from 'react';
import { IconCopy, IconEdit, IconRefresh } from './shell-icons';

export type MessageActionsProps = {
  text: string;
  showRetry: boolean;
  onRetry?: (() => void) | undefined;
  showEdit?: boolean;
  onEdit?: (() => void) | undefined;
  disabled?: boolean;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
};

export function MessageActions(props: MessageActionsProps): ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    const payload = props.text.trim();
    if (!payload) {
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      props.onFeedback?.('Copied to clipboard', 'success');
    } catch {
      props.onFeedback?.('Could not copy to clipboard', 'error');
    }
  }

  return (
    <div className="message-actions" data-testid="message-actions">
      <button
        type="button"
        className="msg-action-btn"
        onClick={() => void handleCopy()}
        title="Copy"
        aria-label="Copy message"
        data-testid="message-copy-btn"
      >
        <IconCopy />
        <span className="sr-only">{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {props.showEdit && props.onEdit ? (
        <button
          type="button"
          className="msg-action-btn"
          onClick={props.onEdit}
          disabled={props.disabled}
          title="Edit and resend"
          aria-label="Edit and resend message"
          data-testid="message-edit-btn"
        >
          <IconEdit width={14} height={14} />
          <span className="sr-only">Edit</span>
        </button>
      ) : null}
      {props.showRetry && props.onRetry ? (
        <button
          type="button"
          className="msg-action-btn"
          onClick={props.onRetry}
          disabled={props.disabled}
          title="Retry"
          aria-label="Retry message"
          data-testid="message-retry-btn"
        >
          <IconRefresh />
          <span className="sr-only">Retry</span>
        </button>
      ) : null}
    </div>
  );
}

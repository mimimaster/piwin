/**
 * SF-03: Hover action footer for completed assistant responses.
 * Shows Duplicate (latest only) + Fork (all completed) as inline SVG icon buttons.
 */
import { useState, type ReactElement } from 'react';
import { IconDuplicateConversation, IconForkConversation } from './shell-icons';

export type AssistantResponseActionsProps = {
  messageId: string;
  showDuplicate: boolean;
  showFork: boolean;
  /** Number of direct forks from this response (0 = no count badge). */
  directForkCount: number;
  disabled: boolean;
  onDuplicate: () => void;
  onFork: (messageId: string) => void;
  onOpenForks?: ((messageId: string) => void) | undefined;
  locale: 'zh-CN' | 'en';
};

export function AssistantResponseActions(props: AssistantResponseActionsProps): ReactElement | null {
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [forkBusy, setForkBusy] = useState(false);

  if (!props.showDuplicate && !props.showFork) return null;

  const duplicateLabel = props.locale === 'zh-CN' ? '复制整个会话' : 'Duplicate conversation';
  const forkLabel = props.locale === 'zh-CN' ? '从此处分叉' : 'Fork from here';
  const forksLabel = props.locale === 'zh-CN' ? '个分支' : 'forks';

  async function handleDuplicate(): Promise<void> {
    if (props.disabled || duplicateBusy) return;
    setDuplicateBusy(true);
    try {
      props.onDuplicate();
    } finally {
      setDuplicateBusy(false);
    }
  }

  async function handleFork(): Promise<void> {
    if (props.disabled || forkBusy) return;
    setForkBusy(true);
    try {
      props.onFork(props.messageId);
    } finally {
      setForkBusy(false);
    }
  }

  return (
    <div className="message-actions assistant-response-actions" data-testid="assistant-response-actions">
      {props.showDuplicate ? (
        <button
          type="button"
          className="msg-action-btn"
          onClick={() => void handleDuplicate()}
          disabled={props.disabled || duplicateBusy}
          title={duplicateLabel}
          aria-label={duplicateLabel}
          data-testid="response-duplicate-btn"
        >
          <IconDuplicateConversation width={14} height={14} />
          <span className="sr-only">{duplicateLabel}</span>
        </button>
      ) : null}
      {props.showFork ? (
        <button
          type="button"
          className="msg-action-btn"
          onClick={() => void handleFork()}
          disabled={props.disabled || forkBusy}
          title={forkLabel}
          aria-label={forkLabel}
          data-testid="response-fork-btn"
        >
          <IconForkConversation width={14} height={14} />
          <span className="sr-only">{forkLabel}</span>
        </button>
      ) : null}
      {props.directForkCount > 0 && props.onOpenForks ? (
        <button
          type="button"
          className="msg-action-btn fork-count-badge"
          onClick={() => props.onOpenForks?.(props.messageId)}
          title={`${props.directForkCount} ${forksLabel}`}
          aria-label={`${props.directForkCount} ${forksLabel}`}
          data-testid="response-fork-count"
        >
          <span style={{ fontSize: '11px' }}>{props.directForkCount}</span>
          <IconForkConversation width={11} height={11} />
        </button>
      ) : null}
    </div>
  );
}

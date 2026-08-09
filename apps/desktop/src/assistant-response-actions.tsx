/**
 * SF-03: Persistent action footer for completed assistant responses.
 * Shows Duplicate + Fork as inline SVG icon buttons with hover tooltips.
 */
import { useState, type ReactElement } from 'react';
import type { ProductSessionLineageView } from '@piwin/contracts';
import { IconDuplicateConversation, IconForkConversation } from './shell-icons';
import { SessionLineagePopover } from './session-lineage-popover';

export type AssistantResponseActionsProps = {
  messageId: string;
  showDuplicate: boolean;
  showFork: boolean;
  /** Number of direct forks from this response (0 = no count badge). */
  directForkCount: number;
  /** Complete product lineage for the active session, when available. */
  lineage?: ProductSessionLineageView | null;
  /** Show a tree trigger on the latest response even without direct forks there. */
  showTreeOnLatestResponse?: boolean;
  disabled: boolean;
  onDuplicate: () => void;
  onFork: (messageId: string) => void;
  onOpenForks?: ((messageId: string) => void) | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
  locale: 'zh-CN' | 'en';
};

export function AssistantResponseActions(props: AssistantResponseActionsProps): ReactElement | null {
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [forkBusy, setForkBusy] = useState(false);

  if (!props.showDuplicate && !props.showFork) return null;

  const duplicateLabel = props.locale === 'zh-CN' ? '复制整个会话' : 'Duplicate conversation';
  const forkLabel = props.locale === 'zh-CN' ? '从此处分叉' : 'Fork from here';

  async function handleDuplicate(): Promise<void> {
    if (props.disabled || duplicateBusy) return;
    setDuplicateBusy(true);
    try {
      await props.onDuplicate();
    } finally {
      setDuplicateBusy(false);
    }
  }

  async function handleFork(): Promise<void> {
    if (props.disabled || forkBusy) return;
    setForkBusy(true);
    try {
      await props.onFork(props.messageId);
    } finally {
      setForkBusy(false);
    }
  }

  return (
    <div className="assistant-response-actions" data-testid="assistant-response-actions">
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
          <span className="assistant-action-tooltip" role="tooltip">
            {duplicateLabel}
          </span>
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
          <span className="assistant-action-tooltip" role="tooltip">
            {forkLabel}
          </span>
        </button>
      ) : null}
      {props.lineage && props.onOpenSession ? (
        <SessionLineagePopover
          messageId={props.messageId}
          lineage={props.lineage}
          directForkCount={props.directForkCount}
          showTreeOnLatestResponse={props.showTreeOnLatestResponse === true}
          onOpenSession={props.onOpenSession}
          {...(props.onOpenForks ? { onOpenForks: props.onOpenForks } : {})}
          locale={props.locale}
        />
      ) : null}
    </div>
  );
}

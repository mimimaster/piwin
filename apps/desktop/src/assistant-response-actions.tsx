/**
 * SF-03: Persistent action footer for completed assistant responses.
 * Shows Duplicate + Fork as a compact, right-aligned response action dock.
 */
import { useState, type ReactElement } from 'react';
import type { ProductSessionLineageView } from '@piwin/contracts';
import { IconArrowFork, IconCheck, IconCopy, IconGit } from '@piwin/ui-kit';
import { writeTextToSystemClipboard } from './desktop-clipboard';
import { SessionLineagePopover } from './session-lineage-popover';

export type AssistantResponseActionsProps = {
  messageId: string;
  messageText?: string;
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
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  locale: 'zh-CN' | 'en';
};

export function AssistantResponseActions(
  props: AssistantResponseActionsProps,
): ReactElement | null {
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [forkBusy, setForkBusy] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  const hasCopyText = Boolean(props.messageText && props.messageText.trim().length > 0);

  if (!props.showDuplicate && !props.showFork && !hasCopyText) return null;

  const copyLabel = props.locale === 'zh-CN' ? '复制消息内容' : 'Copy message';
  const duplicateLabel = props.locale === 'zh-CN' ? '复制整个会话' : 'Duplicate conversation';
  const forkLabel = props.locale === 'zh-CN' ? '从此处分叉' : 'Fork from here';

  async function handleCopyText(): Promise<void> {
    const textToCopy = props.messageText?.trim();
    if (!textToCopy) return;
    try {
      await writeTextToSystemClipboard(textToCopy);
      setCopiedText(true);
      window.setTimeout(() => setCopiedText(false), 1500);
      props.onFeedback?.('Message copied to clipboard', 'info');
    } catch {
      props.onFeedback?.('Could not copy to clipboard', 'error');
    }
  }

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
      <div className="assistant-response-action-group">
        {hasCopyText ? (
          <button
            type="button"
            className="msg-action-btn"
            onClick={() => void handleCopyText()}
            disabled={props.disabled}
            title={copyLabel}
            aria-label={copyLabel}
            data-testid="response-copy-btn"
          >
            {copiedText ? (
              <IconCheck width={17} height={17} stroke={1.8} />
            ) : (
              <IconCopy width={17} height={17} stroke={1.8} />
            )}
            <span className="assistant-action-tooltip" role="tooltip">
              {copyLabel}
            </span>
          </button>
        ) : null}
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
            <IconArrowFork width={17} height={17} stroke={1.8} />
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
            <IconGit width={17} height={17} stroke={1.8} />
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
    </div>
  );
}

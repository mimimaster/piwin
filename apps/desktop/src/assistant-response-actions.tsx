/**
 * SF-03: Persistent action footer for completed assistant responses.
 *
 * Inkstone proto-00: `.turn-colophon` with `.colo-meta` on the left and
 * `.acts-f` icon buttons on the right (dashed top rule).
 */
import { useState, type ReactElement } from 'react';
import type { ProductSessionLineageView } from '@piwin/contracts';
import { IconCheck, IconCopy, IconFork, IconRefresh } from '@piwin/ui-kit';
import { writeTextToSystemClipboard } from './desktop-clipboard';
import { SessionLineagePopover } from './session-lineage-popover';

export type AssistantResponseActionsProps = {
  messageId: string;
  messageText?: string;
  /** Left meta for `.colo-meta` — tokens only (e.g. "本轮消耗 1.8k tokens"). */
  colophonMeta?: string | null;
  showFork: boolean;
  showRegenerate?: boolean;
  /** Number of direct forks from this response (0 = no count badge). */
  directForkCount: number;
  /** Complete product lineage for the active session, when available. */
  lineage?: ProductSessionLineageView | null;
  /** Show a tree trigger on the latest response even without direct forks there. */
  showTreeOnLatestResponse?: boolean;
  disabled: boolean;
  onFork: (messageId: string) => void;
  onRegenerate?: () => void;
  onOpenForks?: ((messageId: string) => void) | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  locale: 'zh-CN' | 'en';
};

const ICON = { width: 16, height: 16, stroke: 1.6 } as const;

export function AssistantResponseActions(
  props: AssistantResponseActionsProps,
): ReactElement | null {
  const [forkBusy, setForkBusy] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  const hasCopyText = Boolean(props.messageText && props.messageText.trim().length > 0);

  if (!props.showFork && !props.showRegenerate && !hasCopyText) return null;

  const copyLabel = props.locale === 'zh-CN' ? '复制' : 'Copy';
  const forkLabel = props.locale === 'zh-CN' ? '从这里分叉' : 'Fork from here';
  const regenerateLabel = props.locale === 'zh-CN' ? '重新生成' : 'Regenerate';
  const meta = props.colophonMeta?.trim() || null;

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
    <div
      className="turn-colophon"
      data-st="idle"
      data-testid="assistant-response-actions"
    >
      <span className="colo-meta">{meta ?? ''}</span>
      <div className="acts-f">
        {hasCopyText ? (
          <button
            type="button"
            className="ib"
            onClick={() => void handleCopyText()}
            disabled={props.disabled}
            title={copyLabel}
            aria-label={copyLabel}
            data-testid="response-copy-btn"
          >
            {copiedText ? <IconCheck {...ICON} /> : <IconCopy {...ICON} />}
          </button>
        ) : null}
        {props.showFork ? (
          <button
            type="button"
            className="ib"
            onClick={() => void handleFork()}
            disabled={props.disabled || forkBusy}
            title={forkLabel}
            aria-label={forkLabel}
            data-testid="response-fork-btn"
          >
            <IconFork {...ICON} />
          </button>
        ) : null}
        {props.showRegenerate && props.onRegenerate ? (
          <button
            type="button"
            className="ib"
            onClick={props.onRegenerate}
            disabled={props.disabled}
            title={regenerateLabel}
            aria-label={regenerateLabel}
            data-testid="response-regenerate-btn"
          >
            <IconRefresh {...ICON} />
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
        ) : props.directForkCount > 0 ? (
          <span className="fk" data-testid="response-fork-count">
            {props.directForkCount}
            {props.locale === 'zh-CN'
              ? ' 个分叉'
              : props.directForkCount === 1
                ? ' fork'
                : ' forks'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Walkthrough action button + card mount for a single Assistant message (spec §5.1–5.3).
 *
 * Eligibility (§5.1): only the final Assistant message of a completed, non-failed
 * run shows the Generate button. Streaming, middle, failed/cancelled, and disabled
 * messages never show it. An existing artifact (generating/ready/error) always
 * renders its card regardless of enabled state (§5.5 — old artifacts stay viewable).
 */
import type { ReactElement } from 'react';
import type { WalkthroughArtifact } from '@piwin/contracts';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';
import { WalkthroughCard } from './walkthrough-card';

export type WalkthroughActionProps = {
  message: ChatMessageUi;
  /** Artifact bound to this message, if any. */
  artifact?: WalkthroughArtifact | undefined;
  /** Whether the Generate button should be shown (pre-computed by parent). */
  eligible: boolean;
  /** Locale for user-facing strings (defaults to English when omitted). */
  locale?: 'zh-CN' | 'en';
  onGenerate: (messageId: string, force?: boolean) => void | Promise<void>;
  onCancel?: ((messageId: string, generationId?: string) => void | Promise<void>) | undefined;
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
};

/**
 * Pure eligibility check (spec §5.1). Exported for unit testing.
 * Returns true only when the Generate button should be shown.
 */
export function isWalkthroughEligible(params: {
  message: ChatMessageUi;
  messages: ChatMessageUi[];
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  enabled: boolean;
}): boolean {
  const { message, messages, runRecordsById, activeRunId, enabled } = params;
  if (!enabled) return false;
  if (message.role !== 'assistant') return false;
  if (message.status !== 'done') return false;
  // Non-empty text or summarizable tool/plan info.
  const hasContent = message.text.trim().length > 0 || message.tools.length > 0;
  if (!hasContent) return false;

  const runId = message.runId;
  if (runId) {
    // Run must not be active.
    if (activeRunId === runId) return false;
    const record = runRecordsById[runId];
    if (record?.outcome === 'failed' || record?.outcome === 'cancelled') return false;
    // Must be the final assistant message of this run.
    const lastAssistantForRun = findLastAssistantForRun(messages, runId);
    if (lastAssistantForRun !== message.id) return false;
    // Legacy compat: runId present but no outcome — only if endedAt exists.
    if (!record?.outcome && record?.endedAt === null) return false;
  }
  // No runId (legacy) — allowed when done + non-empty (already checked).
  return true;
}

function findLastAssistantForRun(messages: ChatMessageUi[], runId: string): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === 'assistant' && msg.runId === runId) {
      return msg.id;
    }
  }
  return null;
}

export function WalkthroughAction(props: WalkthroughActionProps): ReactElement | null {
  const { message, artifact, eligible, locale } = props;
  const isZh = locale === 'zh-CN';

  // No button and no artifact → render nothing.
  if (!eligible && !artifact) return null;

  const isGenerating = artifact?.status === 'generating';
  const generateLabel = isZh ? '生成演练' : 'Generate Walkthrough';
  const generatingLabel = isZh ? '生成中…' : 'Generating…';

  // When a ready artifact exists, WalkthroughCard already renders the
  // View + Regenerate buttons (testids walkthrough-doc-btn-* and
  // walkthrough-regenerate-btn-*). Rendering them again here would duplicate
  // the walkthrough-regenerate-btn-* testid. So the action's own button
  // section only shows the Generate button when there is no ready artifact
  // (i.e., no artifact, or generating/error state).
  const showGenerateButton = eligible && !(artifact && artifact.status === 'ready');

  return (
    <div className="walkthrough-action" data-testid={`walkthrough-action-${message.id}`}>
      {showGenerateButton ? (
        <div className="walkthrough-action-buttons">
          <button
            type="button"
            className="walkthrough-btn walkthrough-generate-btn"
            onClick={() => void props.onGenerate(message.id, false)}
            disabled={isGenerating}
            aria-label={generateLabel}
            title={generateLabel}
            data-testid={`walkthrough-generate-btn-${message.id}`}
          >
            {isGenerating ? generatingLabel : generateLabel}
          </button>
        </div>
      ) : null}
      {artifact ? (
        <WalkthroughCard
          artifact={artifact}
          messageId={message.id}
          {...(locale ? { locale } : {})}
          onOpenDocument={props.onOpenDocument}
          onRegenerate={eligible ? () => void props.onGenerate(message.id, true) : undefined}
          onCancel={props.onCancel}
        />
      ) : null}
    </div>
  );
}

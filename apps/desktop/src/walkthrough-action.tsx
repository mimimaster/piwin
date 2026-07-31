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
  const { message, artifact, eligible } = props;

  // No button and no artifact → render nothing.
  if (!eligible && !artifact) return null;

  const isGenerating = artifact?.status === 'generating';

  return (
    <div className="walkthrough-action" data-testid={`walkthrough-action-${message.id}`}>
      {eligible ? (
        <div className="walkthrough-action-buttons">
          {artifact && artifact.status === 'ready' ? (
            <>
              <button
                type="button"
                className="walkthrough-btn walkthrough-view-btn"
                onClick={() =>
                  props.onOpenDocument?.({
                    title: 'Walkthrough',
                    path: `walkthroughs/${message.id}.md`,
                    content: artifact.markdown,
                  })
                }
                aria-label="View Walkthrough"
                title="View Walkthrough"
                data-testid={`walkthrough-view-btn-${message.id}`}
              >
                View Walkthrough
              </button>
              <button
                type="button"
                className="walkthrough-btn walkthrough-regenerate-btn"
                onClick={() => void props.onGenerate(message.id, true)}
                aria-label="Regenerate Walkthrough"
                title="Regenerate Walkthrough"
                data-testid={`walkthrough-regenerate-btn-${message.id}`}
              >
                Regenerate
              </button>
            </>
          ) : (
            <button
              type="button"
              className="walkthrough-btn walkthrough-generate-btn"
              onClick={() => void props.onGenerate(message.id, false)}
              disabled={isGenerating}
              aria-label="Generate Walkthrough"
              title="Generate Walkthrough"
              data-testid={`walkthrough-generate-btn-${message.id}`}
            >
              {isGenerating ? 'Generating…' : 'Generate Walkthrough'}
            </button>
          )}
        </div>
      ) : null}
      {artifact ? (
        <WalkthroughCard
          artifact={artifact}
          messageId={message.id}
          onOpenDocument={props.onOpenDocument}
          onRegenerate={eligible ? () => void props.onGenerate(message.id, true) : undefined}
          onCancel={props.onCancel}
        />
      ) : null}
    </div>
  );
}

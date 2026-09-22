/**
 * Empty `message/start` rows, hidden.
 *
 * Pi opens a new assistant message before it has anything to put in it. That
 * row is lifecycle chrome, not content: the run status footer already says the
 * turn is live, so painting a bare bubble for it only adds a blank line to the
 * transcript — the stray line break users kept seeing after a long answer.
 *
 * `model-wait-tail.ts` already hid one such row, but only in the narrow case
 * it was written for (a settled *tool* round followed by a model wait). When
 * the preceding row was a text answer the placeholder stayed visible, which is
 * the common shape for models that alternate answer → reasoning → answer.
 *
 * Two rows are deliberately never hidden:
 *   - The turn's first assistant row. It owns the identity header and the
 *     "sent, waiting for the first token" state, and nothing renders above it.
 *   - Anything carrying an error. A failed row is the only place the turn's
 *     diagnostics render.
 *
 * Pure projection over one turn's messages in transcript order.
 */
import { isAssistantRowVisuallyEmpty } from './assistant-message-content.js';
import type { ChatMessageUi } from './chat-ui-types.js';

export type ResolveHiddenLifecyclePlaceholdersInput = {
  /** Messages of one turn, transcript order. */
  messages: readonly ChatMessageUi[];
  /** The thread is producing output. Settled empty rows are pruned elsewhere. */
  streaming: boolean;
  /** Reasoning display is on, so a thinking-only row still paints something. */
  showThinking: boolean;
  /** A gate is open; it renders inside these rows, so hide nothing. */
  permissionPending: boolean;
};

export function resolveHiddenLifecyclePlaceholderIds(
  input: ResolveHiddenLifecyclePlaceholdersInput,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  if (!input.streaming || input.permissionPending) {
    return hidden;
  }

  let sawRenderedAssistantRow = false;
  for (const message of input.messages) {
    if (message.role !== 'assistant') continue;
    if (!isAssistantRowVisuallyEmpty(message, { showThinking: input.showThinking })) {
      sawRenderedAssistantRow = true;
      continue;
    }
    if (message.status === 'error' || message.error !== undefined) continue;
    // A settled empty row is pruned by the row's own guard; only the live
    // placeholder escapes it, and only that one needs hiding here.
    if (message.status !== 'streaming') continue;
    if (!sawRenderedAssistantRow) continue;
    hidden.add(message.id);
  }

  return hidden;
}

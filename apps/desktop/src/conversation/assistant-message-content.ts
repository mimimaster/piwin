/** Whether an assistant bubble carries anything the transcript can render. */
import type { ChatMessageUi } from './chat-reducer';

/**
 * Content-only emptiness: deliberately ignores `status`, `error` and run
 * outcome so callers can combine it with their own lifecycle rules (a
 * completed empty row is a prunable placeholder, a streaming empty row is a
 * turn still waiting for its first token).
 */
export function isAssistantContentEmpty(message: ChatMessageUi): boolean {
  return (
    message.role === 'assistant' &&
    message.text.trim().length === 0 &&
    message.thinking.trim().length === 0 &&
    message.tools.length === 0 &&
    message.attachments.length === 0 &&
    (message.searchEvidence?.citations.length ?? 0) === 0
  );
}

/**
 * Emptiness as the reader sees it, rather than as the data reads.
 *
 * `isAssistantContentEmpty` counts reasoning as content, which is right for
 * pruning but wrong for layout: with thinking switched off, a row carrying
 * only reasoning paints nothing and reads as a stray blank line. Subagent
 * cards and doc-card sequences render their own chrome, so they count as
 * content whatever the thinking setting says.
 */
export function isAssistantRowVisuallyEmpty(
  message: ChatMessageUi,
  options: { showThinking: boolean },
): boolean {
  return (
    message.role === 'assistant' &&
    message.text.trim().length === 0 &&
    (!options.showThinking || message.thinking.trim().length === 0) &&
    message.tools.length === 0 &&
    message.attachments.length === 0 &&
    (message.searchEvidence?.citations.length ?? 0) === 0 &&
    message.subagentActivity === undefined &&
    message.docCardSequence === undefined &&
    message.instructionDelivery === undefined &&
    message.replyWriterPending !== true
  );
}

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

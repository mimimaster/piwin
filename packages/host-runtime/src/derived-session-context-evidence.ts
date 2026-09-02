import type { SessionTranscriptMessage } from '@piwin/contracts';

/** Whether a completed assistant row is enough to establish displayable history. */
export function hasDisplayableAssistantResponse(message: SessionTranscriptMessage): boolean {
  if (message.role !== 'assistant' || message.status !== 'done') {
    return false;
  }
  return (
    message.text.trim().length > 0 ||
    (message.thinking?.trim().length ?? 0) > 0 ||
    (message.tools?.length ?? 0) > 0
  );
}

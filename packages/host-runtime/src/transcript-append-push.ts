import type { HostPush, SessionTranscriptMessage } from '@piwin/contracts';

export function transcriptAppendPush(
  sessionId: string,
  message: SessionTranscriptMessage,
): Extract<HostPush, { type: 'transcript/append' }> {
  return { type: 'transcript/append', sessionId, message };
}

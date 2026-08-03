/**
 * Pure reconciliation between persisted child-session history and the live
 * streaming tail. Persisted transcript messages are the source of truth for
 * history; SubagentStreamState is only the live tail. React components must
 * not re-implement the message-id deduplication below.
 */
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { mapTranscriptMessagesToUi, type ChatMessageUi, type SubagentStreamState } from './chat-reducer';

export type SubagentTranscriptView = {
  /** Persisted messages, minus the one currently represented by the live tail. */
  historicalMessages: ChatMessageUi[];
  /** Live tail; null when the child is not currently emitting stream events. */
  liveTail: SubagentStreamState | null;
};

/**
 * Combine persisted history with the live tail into one continuous transcript.
 *
 * While the child is **actively streaming**, the message matching
 * `stream.currentMessageId` is represented only by the live tail so the
 * current assistant bubble is not rendered twice.
 *
 * After the stream ends (`streaming === false`):
 * - if history already contains that message id, history is the source of
 *   truth and the live tail is dropped (avoids flash-empty when
 *   `subagent/clear-stream` races a terminal refresh);
 * - if history has not caught up yet, keep the terminal live tail until
 *   refresh lands.
 */
export function reconcileSubagentTranscript(input: {
  historicalMessages: SessionTranscriptMessage[];
  stream: SubagentStreamState | null;
}): SubagentTranscriptView {
  const stream = input.stream;
  if (stream === null) {
    return {
      historicalMessages: mapTranscriptMessagesToUi(input.historicalMessages),
      liveTail: null,
    };
  }

  const currentMessageId = stream.currentMessageId;
  if (stream.streaming === true) {
    const dedupedHistory =
      currentMessageId !== null
        ? input.historicalMessages.filter((message) => message.id !== currentMessageId)
        : input.historicalMessages;
    return {
      historicalMessages: mapTranscriptMessagesToUi(dedupedHistory),
      liveTail: stream,
    };
  }

  // Terminal stream: prefer persisted history when it already includes the
  // final message; otherwise keep the tail until a history refresh arrives.
  const historyAlreadyHasLiveMessage =
    currentMessageId !== null &&
    input.historicalMessages.some((message) => message.id === currentMessageId);
  return {
    historicalMessages: mapTranscriptMessagesToUi(input.historicalMessages),
    liveTail: historyAlreadyHasLiveMessage ? null : stream,
  };
}

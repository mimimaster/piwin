/**
 * Pure reconciliation between persisted child-session history and the live
 * streaming state. Persisted transcript messages are the source of truth for
 * history; SubagentStreamState carries completed-but-unpersisted segments
 * plus the live tail. React components must not re-implement the message-id
 * deduplication below.
 */
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  mapTranscriptMessagesToUi,
  type ChatMessageUi,
  type SubagentStreamSegment,
  type SubagentStreamState,
} from './chat-reducer';

export type SubagentTranscriptView = {
  /**
   * Persisted messages followed by completed live segments that history has
   * not absorbed yet (deduplicated by message id).
   */
  historicalMessages: ChatMessageUi[];
  /** Live tail; null when the current message has nothing left to show. */
  liveTail: SubagentStreamState | null;
};

/** Render one retained stream segment as a finished assistant message. */
export function subagentSegmentToUiMessage(
  segment: SubagentStreamSegment,
  status: ChatMessageUi['status'] = 'done',
): ChatMessageUi {
  return {
    id: segment.messageId,
    role: 'assistant',
    text: segment.text,
    thinking: segment.thinking,
    tools: segment.tools.map((tool) => ({
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      status: tool.status,
      output: tool.output,
      ...(tool.outputRetainedBytes !== undefined
        ? { outputRetainedBytes: tool.outputRetainedBytes }
        : {}),
      ...(tool.outputTruncated !== undefined ? { outputTruncated: tool.outputTruncated } : {}),
      ...(tool.presentation ? { presentation: tool.presentation } : {}),
      ...(tool.runId ? { runId: tool.runId } : {}),
      ...(tool.responseMessageId ? { responseMessageId: tool.responseMessageId } : {}),
    })),
    attachments: segment.attachments ?? [],
    status,
    ...(segment.searchEvidence ? { searchEvidence: segment.searchEvidence } : {}),
  };
}

/**
 * Combine persisted history, retained completed segments, and the live tail
 * into one continuous transcript.
 *
 * Completed segments render as finished assistant messages unless persisted
 * history already contains the same message id (history is authoritative).
 *
 * While the child is **actively streaming**, the message matching
 * `stream.currentMessageId` is represented only by the live tail so the
 * current assistant bubble is not rendered twice.
 *
 * After the stream ends (`streaming === false`) the tail stays only when the
 * current message still has content that history has not caught up with
 * (e.g. an aborted partial message); a normally finished message has already
 * moved into `completedSegments`.
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

  const persistedIds = new Set(input.historicalMessages.map((message) => message.id));
  const segmentMessages = stream.completedSegments
    .filter((segment) => !persistedIds.has(segment.messageId))
    .map((segment) => subagentSegmentToUiMessage(segment));

  const currentMessageId = stream.currentMessageId;
  if (stream.streaming === true) {
    const dedupedHistory =
      currentMessageId !== null
        ? input.historicalMessages.filter((message) => message.id !== currentMessageId)
        : input.historicalMessages;
    return {
      historicalMessages: [...mapTranscriptMessagesToUi(dedupedHistory), ...segmentMessages],
      liveTail: stream,
    };
  }

  // Terminal stream: prefer persisted history when it already includes the
  // current message; otherwise keep the tail while it still has content
  // (aborted partials) until a history refresh arrives.
  const currentHasContent =
    stream.text.length > 0 ||
    stream.thinking.length > 0 ||
    stream.tools.length > 0 ||
    (stream.attachments?.length ?? 0) > 0 ||
    stream.searchEvidence !== undefined;
  const historyAlreadyHasLiveMessage =
    currentMessageId !== null && persistedIds.has(currentMessageId);
  return {
    historicalMessages: [...mapTranscriptMessagesToUi(input.historicalMessages), ...segmentMessages],
    liveTail: currentHasContent && !historyAlreadyHasLiveMessage ? stream : null,
  };
}

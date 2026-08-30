import type { SessionTranscriptMessage } from '@piwin/contracts';
import { SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS } from '@piwin/contracts';
import { extractUserFacingBody } from '@piwin/session/derive-default-name';
import {
  appendBoundedText,
  createBoundedTextAccumulator,
  type BoundedTextAccumulator,
  type BoundedTextAccumulatorOptions,
} from './bounded-text-accumulator';
import { retainBoundedTranscriptWindow } from './transcript-page-cache';
import type { ChatMessageUi, ChatUiState, RunRecordUi } from './chat-ui-types';
import { createBoundedToolOutput, projectBoundedToolPresentation } from './chat-reducer-tools';

export const MAX_LIVE_ASSISTANT_TEXT_BYTES = 500_000;
export const MAX_LIVE_THINKING_BYTES = 200_000;
export const STREAMING_TEXT_TRUNCATION_MARKER = '\n[display truncated: retention limit reached]';
export const STREAMING_THINKING_TRUNCATION_MARKER =
  '\n[reasoning truncated: retention limit reached]';
export const STREAMING_TEXT_RETENTION_OPTIONS: BoundedTextAccumulatorOptions = {
  maximumBytes: MAX_LIVE_ASSISTANT_TEXT_BYTES,
  truncationMarker: STREAMING_TEXT_TRUNCATION_MARKER,
};
export const STREAMING_THINKING_RETENTION_OPTIONS: BoundedTextAccumulatorOptions = {
  maximumBytes: MAX_LIVE_THINKING_BYTES,
  truncationMarker: STREAMING_THINKING_TRUNCATION_MARKER,
};

const TRANSCRIPT_LIVE_TAIL_PIN_COUNT = 3;

const textEncoder = new TextEncoder();

export function calculateUtf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

/**
 * Append a delta to live streamed text with incremental UTF-8 accounting.
 * The ordinary path encodes only the delta; retained state that predates the
 * accounting fields (legacy fixtures, hydrated history) is normalized once
 * with a single full encode before the first append. Once truncated, every
 * later append is a constant-time no-op — the head is kept and marked.
 */
export function appendBoundedLiveText(
  accumulator: {
    text: string;
    retainedBytes?: number | undefined;
    truncated?: boolean | undefined;
  },
  delta: string,
  options: BoundedTextAccumulatorOptions,
): BoundedTextAccumulator {
  const normalized: BoundedTextAccumulator = accumulator.truncated
    ? {
        text: accumulator.text,
        retainedBytes: accumulator.retainedBytes ?? calculateUtf8ByteLength(accumulator.text),
        truncated: true,
      }
    : accumulator.retainedBytes === undefined
      ? createBoundedTextAccumulator(accumulator.text, options)
      : {
          text: accumulator.text,
          retainedBytes: accumulator.retainedBytes,
          truncated: false,
        };
  return appendBoundedText(normalized, delta, options);
}

export function mapTranscriptMessagesToUi(
  messages: SessionTranscriptMessage[],
  options: { keepStreamingStatus?: boolean } = {},
): ChatMessageUi[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    // Legacy transcripts may still store mode/skill wrappers that were once
    // sent as input.text. Project only the human-authored body for display;
    // attachments stay untouched so vision media still renders as originals.
    text:
      message.role === 'user'
        ? extractUserFacingBody(typeof message.text === 'string' ? message.text : '')
        : (message.text ?? ''),
    thinking: message.thinking ?? '',
    tools: (message.tools ?? []).map((tool) => {
      const output = createBoundedToolOutput(tool.presentation?.output?.text ?? tool.output ?? '');
      return {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        status: tool.status,
        output: output.text,
        outputRetainedBytes: output.retainedBytes,
        outputTruncated: output.truncated,
        ...(tool.runId ? { runId: tool.runId } : {}),
        ...(tool.responseMessageId ? { responseMessageId: tool.responseMessageId } : {}),
        ...(tool.presentation
          ? { presentation: projectBoundedToolPresentation(tool.presentation, output) }
          : {}),
      };
    }),
    attachments: message.attachments ?? [],
    status:
      options.keepStreamingStatus === true
        ? message.status
        : message.status === 'streaming'
          ? 'done'
          : message.status,
    ...(message.searchEvidence ? { searchEvidence: message.searchEvidence } : {}),
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    ...(message.runId ? { runId: message.runId } : {}),
    ...(message.thinkingStartedAt !== undefined
      ? { thinkingStartedAt: parseEventTime(message.thinkingStartedAt) }
      : {}),
    ...(message.thinkingEndedAt !== undefined
      ? { thinkingEndedAt: parseEventTime(message.thinkingEndedAt) }
      : {}),
    ...(message.subagentActivity ? { subagentActivity: message.subagentActivity } : {}),
    ...(message.instructionDelivery ? { instructionDelivery: message.instructionDelivery } : {}),
    ...(message.docCardSequence ? { docCardSequence: message.docCardSequence } : {}),
    ...(message.contextRefs && message.contextRefs.length > 0
      ? { contextRefs: message.contextRefs }
      : {}),
    ...(message.source ? { source: message.source } : {}),
    ...(message.voiceCallId ? { voiceCallId: message.voiceCallId } : {}),
    ...(message.model ? { model: message.model } : {}),
    ...(message.replyWriter
      ? {
          replyWriter: {
            model: message.replyWriter.model,
            language: message.replyWriter.language,
          },
        }
      : {}),
    ...(message.terminalMessage ? { error: message.terminalMessage } : {}),
    ...(message.failure ? { failure: message.failure } : {}),
  }));
}

export function collectLiveTranscriptMessageIds(
  messages: readonly ChatMessageUi[],
  streaming: boolean,
): Set<string> {
  const liveIds = new Set<string>();

  // 1. Retain any message actively streaming or running a tool
  for (const message of messages) {
    if (message.status === 'streaming' || message.tools.some((tool) => tool.status === 'running')) {
      liveIds.add(message.id);
    }
  }

  // 2. Retain the live tail (last N items)
  const tailStart = Math.max(0, messages.length - TRANSCRIPT_LIVE_TAIL_PIN_COUNT);
  for (let index = tailStart; index < messages.length; index += 1) {
    const message = messages[index];
    if (message !== undefined) {
      liveIds.add(message.id);
    }
  }

  // 3. If streaming, also retain the user prompt initiating the active turn
  if (streaming) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        liveIds.add(messages[index]!.id);
        break;
      }
    }
  }

  return liveIds;
}

export function collectRetainedTranscriptMessageIds(
  messages: readonly ChatMessageUi[],
  streaming: boolean,
): Set<string> {
  const retainedIds = collectLiveTranscriptMessageIds(messages, streaming);
  const tailStart = Math.max(0, messages.length - SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS);
  for (let index = tailStart; index < messages.length; index += 1) {
    const message = messages[index];
    if (message !== undefined) retainedIds.add(message.id);
  }
  return retainedIds;
}

export function collectActiveTurnMessageIds(
  messages: readonly ChatMessageUi[],
  streaming: boolean,
): Set<string> {
  let activeStart = messages.findIndex(
    (message) =>
      message.status === 'streaming' || message.tools.some((tool) => tool.status === 'running'),
  );
  if (streaming) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        activeStart = index;
        break;
      }
    }
  }
  if (activeStart < 0) return new Set();
  return new Set(messages.slice(activeStart).map((message) => message.id));
}

export function mergeRefreshedTailWithLiveMessages(
  refreshedMessages: readonly ChatMessageUi[],
  currentMessages: readonly ChatMessageUi[],
  streaming: boolean,
): ChatMessageUi[] {
  const liveIds = collectActiveTurnMessageIds(currentMessages, streaming);
  if (liveIds.size === 0) return [...refreshedMessages];
  const currentLiveMessages = currentMessages.filter((message) => liveIds.has(message.id));
  const durablePrefix = refreshedMessages.filter((message) => !liveIds.has(message.id));
  return [...durablePrefix, ...currentLiveMessages];
}

export function retainRunRecordsForMessages(
  runRecordsById: Readonly<Record<string, RunRecordUi>>,
  messages: readonly ChatMessageUi[],
  activeRunId: string | null,
): Record<string, RunRecordUi> {
  const retainedRunIds = new Set<string>();
  if (activeRunId !== null) retainedRunIds.add(activeRunId);
  for (const message of messages) {
    if (message.runId !== undefined) retainedRunIds.add(message.runId);
    for (const tool of message.tools) {
      if (tool.runId !== undefined) retainedRunIds.add(tool.runId);
    }
  }
  return Object.fromEntries(
    Object.entries(runRecordsById).filter(([runId]) => retainedRunIds.has(runId)),
  );
}

export function enforceBoundedTranscriptWindow(state: ChatUiState): ChatUiState {
  const bounded = retainBoundedTranscriptWindow(
    state.messages,
    collectRetainedTranscriptMessageIds(state.messages, state.streaming),
  );
  const cacheLimitReached =
    (state.transcriptWindow?.cacheLimitReached ?? false) || bounded.cacheLimitReached;
  const transcriptWindow = state.transcriptWindow
    ? {
        revision: state.transcriptWindow.revision,
        totalCount: state.transcriptWindow.totalCount,
        ...(!cacheLimitReached && state.transcriptWindow.olderCursor
          ? { olderCursor: state.transcriptWindow.olderCursor }
          : {}),
        retainedBytes: bounded.retainedBytes,
        cacheLimitReached,
      }
    : null;
  if (bounded.droppedCount === 0) {
    return { ...state, transcriptWindow };
  }
  const retainedMessageIds = new Set(bounded.messages.map((message) => message.id));
  return {
    ...state,
    messages: bounded.messages,
    transcriptWindow,
    runRecordsById: retainRunRecordsForMessages(
      state.runRecordsById,
      bounded.messages,
      state.activeRunId,
    ),
    walkthroughsByMessageId: Object.fromEntries(
      Object.entries(state.walkthroughsByMessageId).filter(([messageId]) =>
        retainedMessageIds.has(messageId),
      ),
    ),
  };
}

export function parseAcceptedAt(acceptedAt: string): number {
  const parsedAt = Date.parse(acceptedAt);
  return Number.isFinite(parsedAt) ? parsedAt : Date.now();
}

export function parseEventTime(eventTime: string): number {
  const parsedAt = Date.parse(eventTime);
  return Number.isFinite(parsedAt) ? parsedAt : Date.now();
}

export function buildRunRecordsFromTranscriptMessages(
  messages: SessionTranscriptMessage[],
): Record<string, RunRecordUi> {
  const records: Record<string, RunRecordUi> = {};
  for (const message of messages) {
    if (!message.runId) {
      continue;
    }
    const existingRecord = records[message.runId];
    const phaseHistory = (message.phaseHistory ?? []).map((entry) => ({
      phase: entry.phase,
      at: parseEventTime(entry.at),
      ...(entry.detail ? { detail: entry.detail } : {}),
    }));
    records[message.runId] = {
      runId: message.runId,
      phaseHistory,
      startedAt: message.startedAt
        ? parseEventTime(message.startedAt)
        : (existingRecord?.startedAt ?? null),
      endedAt: message.endedAt
        ? parseEventTime(message.endedAt)
        : (existingRecord?.endedAt ?? null),
      ...(message.outcome
        ? { outcome: message.outcome }
        : existingRecord?.outcome
          ? { outcome: existingRecord.outcome }
          : {}),
      ...(message.terminalMessage
        ? { terminalMessage: message.terminalMessage }
        : existingRecord?.terminalMessage
          ? { terminalMessage: existingRecord.terminalMessage }
          : {}),
    };
  }
  return records;
}

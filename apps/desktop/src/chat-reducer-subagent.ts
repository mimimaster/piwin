import type { AgentEvent, PromptAttachment } from '@piwin/contracts';
import { mergeSearchEvidence } from '@piwin/contracts';
import {
  evictCompletedFirst,
  MAX_SUBAGENT_BATCHES,
  MAX_SUBAGENT_CHILDREN,
  MAX_SUBAGENT_INVOCATIONS,
  MAX_SUBAGENT_RESULTS,
  MAX_SUBAGENT_REVIEWS,
  MAX_SUBAGENT_TASK_RESULTS,
  MAX_SUBAGENT_VERIFICATIONS,
  putRecordLru,
} from './record-budget';
import { createBoundedTextAccumulator } from './bounded-text-accumulator';
import type {
  ChatUiAction,
  ChatUiState,
  SubagentStreamSegment,
  SubagentStreamState,
  SubagentStreamTool,
} from './chat-ui-types';
import {
  MAX_RETAINED_SUBAGENT_SEGMENT_TEXT_BYTES,
  MAX_RETAINED_SUBAGENT_SEGMENT_THINKING_BYTES,
  MAX_SUBAGENT_STREAM_SEGMENTS,
} from './chat-ui-types';
import {
  STREAMING_TEXT_RETENTION_OPTIONS,
  STREAMING_TEXT_TRUNCATION_MARKER,
  STREAMING_THINKING_RETENTION_OPTIONS,
  STREAMING_THINKING_TRUNCATION_MARKER,
  appendBoundedLiveText,
} from './chat-reducer-transcript';
import { appendBoundedToolOutput } from './chat-reducer-tools';
import { isEnvelopeStale, recordEnvelope } from './chat-reducer-envelope';
import {
  isTerminalSubagentChild,
  isTerminalSubagentInvocation,
  isTerminalSubagentResult,
} from './chat-reducer-session-helpers';
import {
  preferSubagentResult,
  preferSubagentReview,
  preferSubagentVerification,
  verificationFactFromDelivery,
} from './subagent-review-loop-view.js';
import {
  applyPermissionQueueToStream,
  dequeuePermissionPrompt,
  enqueuePermissionPrompt,
  streamPermissionQueue,
} from './permission-queue';

export type ChatUiSubagentAction = Extract<
  ChatUiAction,
  {
    type:
      | 'subagent/stream'
      | 'subagent/updated'
      | 'subagent/invocation-updated'
      | 'subagent/children-hydrate'
      | 'subagent/invocations-hydrate'
      | 'subagent/batch-updated'
      | 'subagent/task-updated'
      | 'subagent/result-updated'
      | 'subagent/clear-stream';
  }
>;

function finishCurrentSubagentSegment(stream: SubagentStreamState): SubagentStreamState {
  if (stream.currentMessageId === null) {
    return stream;
  }
  const boundedText = createBoundedTextAccumulator(stream.text, {
    maximumBytes: MAX_RETAINED_SUBAGENT_SEGMENT_TEXT_BYTES,
    truncationMarker: STREAMING_TEXT_TRUNCATION_MARKER,
  });
  const boundedThinking = createBoundedTextAccumulator(stream.thinking, {
    maximumBytes: MAX_RETAINED_SUBAGENT_SEGMENT_THINKING_BYTES,
    truncationMarker: STREAMING_THINKING_TRUNCATION_MARKER,
  });
  const segment: SubagentStreamSegment = {
    messageId: stream.currentMessageId,
    text: boundedText.text,
    thinking: boundedThinking.text,
    tools: stream.tools,
    ...(boundedText.truncated || boundedThinking.truncated ? { truncated: true } : {}),
    ...(stream.attachments && stream.attachments.length > 0
      ? { attachments: stream.attachments }
      : {}),
    ...(stream.searchEvidence ? { searchEvidence: stream.searchEvidence } : {}),
  };
  const { searchEvidence: _droppedEvidence, ...streamWithoutEvidence } = stream;
  return {
    ...streamWithoutEvidence,
    completedSegments: [...stream.completedSegments, segment].slice(-MAX_SUBAGENT_STREAM_SEGMENTS),
    completionRevision: stream.completionRevision + 1,
    text: '',
    textRetainedBytes: 0,
    textTruncated: false,
    thinking: '',
    thinkingRetainedBytes: 0,
    thinkingTruncated: false,
    truncated: false,
    tools: [],
    attachments: [],
  };
}

/**
 * Attach a tool patch to the completed segment owning `responseMessageId`.
 * Returns null when no completed segment owns that message.
 */
function patchCompletedSegmentTool(
  stream: SubagentStreamState,
  responseMessageId: string,
  patch: (tools: SubagentStreamTool[]) => SubagentStreamTool[],
): SubagentStreamState | null {
  const index = stream.completedSegments.findIndex(
    (segment) => segment.messageId === responseMessageId,
  );
  if (index < 0) {
    return null;
  }
  const segment = stream.completedSegments[index];
  if (!segment) {
    return null;
  }
  const completedSegments = [...stream.completedSegments];
  completedSegments[index] = { ...segment, tools: patch(segment.tools) };
  return { ...stream, completedSegments };
}

function mergeAttachmentsById(
  current: readonly PromptAttachment[] | undefined,
  incoming: readonly PromptAttachment[],
): PromptAttachment[] {
  const merged = [...(current ?? [])];
  for (const attachment of incoming) {
    if (!merged.some((candidate) => candidate.id === attachment.id)) {
      merged.push(attachment);
    }
  }
  return merged;
}

/**
 * Attach tool-produced media to the message that owns `toolCallId`, matching
 * where `patchSubagentToolWherever` placed the tool itself.
 */
function mergeSubagentToolAttachments(
  stream: SubagentStreamState,
  toolCallId: string,
  attachments: readonly PromptAttachment[],
): SubagentStreamState {
  if (attachments.length === 0) {
    return stream;
  }
  if (!stream.tools.some((tool) => tool.toolCallId === toolCallId)) {
    for (let index = stream.completedSegments.length - 1; index >= 0; index -= 1) {
      const segment = stream.completedSegments[index];
      if (segment && segment.tools.some((tool) => tool.toolCallId === toolCallId)) {
        const completedSegments = [...stream.completedSegments];
        completedSegments[index] = {
          ...segment,
          attachments: mergeAttachmentsById(segment.attachments, attachments),
        };
        return { ...stream, completedSegments };
      }
    }
  }
  return { ...stream, attachments: mergeAttachmentsById(stream.attachments, attachments) };
}

/**
 * Apply a tool patch wherever the toolCallId currently lives: the live
 * message first, then completed segments (newest first). Tools finish after
 * their owning message ends, so updates routinely target retained segments.
 */
function patchSubagentToolWherever(
  stream: SubagentStreamState,
  toolCallId: string,
  patch: (tools: SubagentStreamTool[]) => SubagentStreamTool[],
): SubagentStreamState {
  if (stream.tools.some((tool) => tool.toolCallId === toolCallId)) {
    return { ...stream, tools: patch(stream.tools) };
  }
  for (let index = stream.completedSegments.length - 1; index >= 0; index -= 1) {
    const segment = stream.completedSegments[index];
    if (segment && segment.tools.some((tool) => tool.toolCallId === toolCallId)) {
      const completedSegments = [...stream.completedSegments];
      completedSegments[index] = { ...segment, tools: patch(segment.tools) };
      return { ...stream, completedSegments };
    }
  }
  // Unknown toolCallId: patch the live tools (per-tool maps are no-ops there,
  // matching the previous silent-skip behavior).
  return { ...stream, tools: patch(stream.tools) };
}

function applySubagentStreamEvent(
  state: ChatUiState,
  childSessionId: string,
  event: AgentEvent,
): ChatUiState {
  const existing = state.subagentStreams[childSessionId] ?? {
    childSessionId,
    completedSegments: [],
    completionRevision: 0,
    text: '',
    textRetainedBytes: 0,
    textTruncated: false,
    thinking: '',
    thinkingRetainedBytes: 0,
    thinkingTruncated: false,
    truncated: false,
    tools: [],
    attachments: [],
    streaming: false,
    currentMessageId: null,
    permissionPrompt: null,
    permissionQueue: [],
  };

  switch (event.type) {
    case 'message/start': {
      if (event.role !== 'assistant') return state;
      // Defensive: a missing message/end must not drop the previous message.
      const settled = finishCurrentSubagentSegment(existing);
      const { searchEvidence: _previousSearchEvidence, ...streamWithoutSearchEvidence } = settled;
      const updated: SubagentStreamState = {
        ...streamWithoutSearchEvidence,
        streaming: true,
        currentMessageId: event.messageId,
        text: '',
        textRetainedBytes: 0,
        textTruncated: false,
        thinking: '',
        thinkingRetainedBytes: 0,
        thinkingTruncated: false,
        truncated: false,
        tools: [],
        attachments: [],
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/text_delta': {
      const nextText = appendBoundedLiveText(
        {
          text: existing.text,
          retainedBytes: existing.textRetainedBytes,
          truncated: existing.textTruncated,
        },
        event.delta,
        STREAMING_TEXT_RETENTION_OPTIONS,
      );
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        text: nextText.text,
        textRetainedBytes: nextText.retainedBytes,
        textTruncated: nextText.truncated,
        ...(nextText.truncated || existing.truncated ? { truncated: true } : {}),
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/text_snapshot': {
      const boundedText = createBoundedTextAccumulator(
        event.text,
        STREAMING_TEXT_RETENTION_OPTIONS,
      );
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        text: boundedText.text,
        textRetainedBytes: boundedText.retainedBytes,
        textTruncated: boundedText.truncated,
        ...(boundedText.truncated || existing.truncated ? { truncated: true } : {}),
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/thinking_delta': {
      const nextThinking = appendBoundedLiveText(
        {
          text: existing.thinking,
          retainedBytes: existing.thinkingRetainedBytes,
          truncated: existing.thinkingTruncated,
        },
        event.delta,
        STREAMING_THINKING_RETENTION_OPTIONS,
      );
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        thinking: nextThinking.text,
        thinkingRetainedBytes: nextThinking.retainedBytes,
        thinkingTruncated: nextThinking.truncated,
        ...(nextThinking.truncated || existing.truncated ? { truncated: true } : {}),
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/end': {
      // The finished message becomes a retained segment so later messages of
      // the same child cannot erase it from an open child-session window.
      const settled = finishCurrentSubagentSegment(existing);
      const updated: SubagentStreamState = {
        ...settled,
        streaming: false,
        currentMessageId: null,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/search_evidence': {
      const updated: SubagentStreamState = {
        ...existing,
        searchEvidence: existing.searchEvidence
          ? mergeSearchEvidence(existing.searchEvidence, event.evidence)
          : event.evidence,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'tool/start': {
      const tool: SubagentStreamTool = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: 'running',
        output: '',
        outputRetainedBytes: 0,
        outputTruncated: false,
        ...(event.presentation ? { presentation: event.presentation } : {}),
        ...(event.runId ? { runId: event.runId } : {}),
        ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
      };
      // Causal order delivers a message's tools after its message/end. When
      // the owning response is already a completed segment, the tool belongs
      // there — not on the next live message.
      if (event.responseMessageId && event.responseMessageId !== existing.currentMessageId) {
        const patched = patchCompletedSegmentTool(existing, event.responseMessageId, (tools) => {
          const index = tools.findIndex((t) => t.toolCallId === event.toolCallId);
          if (index >= 0) {
            const next = [...tools];
            next[index] = tool;
            return next;
          }
          return [...tools, tool];
        });
        if (patched) {
          return {
            ...state,
            subagentStreams: { ...state.subagentStreams, [childSessionId]: patched },
          };
        }
      }
      const tools = [...existing.tools];
      const existingIdx = tools.findIndex((t) => t.toolCallId === event.toolCallId);
      if (existingIdx >= 0) {
        tools[existingIdx] = tool;
      } else {
        tools.push(tool);
      }
      const updated: SubagentStreamState = { ...existing, tools };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'tool/update': {
      const applyUpdate = (tools: SubagentStreamTool[]): SubagentStreamTool[] =>
        tools.map((tool) => {
          if (tool.toolCallId !== event.toolCallId) {
            return tool;
          }
          const output = appendBoundedToolOutput(tool, event.delta);
          return {
            ...tool,
            output: output.text,
            outputRetainedBytes: output.retainedBytes,
            outputTruncated: output.truncated,
            ...(event.presentation ? { presentation: event.presentation } : {}),
            ...(event.runId ? { runId: event.runId } : {}),
            ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
          };
        });
      const updated = patchSubagentToolWherever(existing, event.toolCallId, applyUpdate);
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'tool/end': {
      const applyEnd = (tools: SubagentStreamTool[]): SubagentStreamTool[] =>
        tools.map((t) =>
          t.toolCallId === event.toolCallId
            ? {
                ...t,
                status: (event.isError ? 'error' : 'done') as 'done' | 'error',
                ...(event.presentation ? { presentation: event.presentation } : {}),
                ...(event.runId ? { runId: event.runId } : {}),
                ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
              }
            : t,
        );
      const withTools = patchSubagentToolWherever(existing, event.toolCallId, applyEnd);
      // Tool output lands on whichever message owns the call. For a finished
      // message that is a completed segment, so attachments must follow the
      // tool there — the live buffer is cleared by the next message/start.
      const updated = mergeSubagentToolAttachments(
        withTools,
        event.toolCallId,
        event.attachments ?? [],
      );
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'session/aborted':
    case 'session/ended': {
      const updated: SubagentStreamState = applyPermissionQueueToStream(
        { ...existing, streaming: false },
        [],
      );
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'permission/request': {
      const updated = applyPermissionQueueToStream(
        existing,
        enqueuePermissionPrompt(streamPermissionQueue(existing), {
          requestId: event.requestId,
          sessionId: childSessionId,
          ...(event.runId ? { runId: event.runId } : {}),
          action: event.action,
          detail: event.detail,
          defaultDecision: event.defaultDecision,
          ...(event.context ? { context: event.context } : {}),
        }),
      );
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'permission/resolved': {
      const currentQueue = streamPermissionQueue(existing);
      const nextQueue = dequeuePermissionPrompt(currentQueue, event.requestId);
      if (nextQueue === currentQueue) return state;
      const updated = applyPermissionQueueToStream(existing, nextQueue);
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    default:
      return state;
  }
}

export function reduceChatSubagent(state: ChatUiState, action: ChatUiSubagentAction): ChatUiState {
  switch (action.type) {
    case 'subagent/stream': {
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      if (action.envelope && isEnvelopeStale(state, action.envelope)) {
        return state;
      }
      const acceptedState = action.envelope ? recordEnvelope(state, action.envelope) : state;
      return applySubagentStreamEvent(acceptedState, action.childSessionId, action.event);
    }
    case 'subagent/updated': {
      // Cross-session guard: child lifecycle pushes for a non-active parent
      // must not leak into the visible children map.
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const child = action.child;
      const nextChildren = { ...state.subagentChildren, [child.id]: child };
      return {
        ...state,
        subagentChildren: evictCompletedFirst(
          nextChildren,
          MAX_SUBAGENT_CHILDREN,
          isTerminalSubagentChild,
        ),
      };
    }
    case 'subagent/invocation-updated': {
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const current = state.subagentInvocations[action.invocation.id];
      if (current && current.revision >= action.invocation.revision) {
        return state;
      }
      return {
        ...state,
        subagentInvocations: evictCompletedFirst(
          {
            ...state.subagentInvocations,
            [action.invocation.id]: action.invocation,
          },
          MAX_SUBAGENT_INVOCATIONS,
          isTerminalSubagentInvocation,
        ),
      };
    }
    case 'subagent/children-hydrate': {
      // Hydrate upserts only children of the active parent; summaries for
      // other parents are intentionally ignored at the application boundary.
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const nextChildren = { ...state.subagentChildren };
      for (const child of action.children) {
        nextChildren[child.id] = child;
      }
      return {
        ...state,
        subagentChildren: evictCompletedFirst(
          nextChildren,
          MAX_SUBAGENT_CHILDREN,
          isTerminalSubagentChild,
        ),
      };
    }
    case 'subagent/invocations-hydrate': {
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const nextInvocations = { ...state.subagentInvocations };
      for (const invocation of action.invocations) {
        const current = nextInvocations[invocation.id];
        if (!current || current.revision < invocation.revision) {
          nextInvocations[invocation.id] = invocation;
        }
      }
      return {
        ...state,
        subagentInvocations: evictCompletedFirst(
          nextInvocations,
          MAX_SUBAGENT_INVOCATIONS,
          isTerminalSubagentInvocation,
        ),
      };
    }
    case 'subagent/batch-updated': {
      if (state.activeSessionId !== action.parentSessionId) return state;
      return {
        ...state,
        subagentBatches: putRecordLru(
          state.subagentBatches,
          action.runId,
          action.result,
          MAX_SUBAGENT_BATCHES,
        ),
      };
    }
    case 'subagent/task-updated': {
      if (state.activeSessionId !== action.parentSessionId) return state;
      const key = `${action.runId}:${action.result.taskId}`;
      const storedTask = state.subagentTaskResults[key];
      const nextTask =
        action.result.review === undefined && storedTask?.review !== undefined
          ? { ...action.result, review: storedTask.review }
          : action.result;
      const nextTaskResults = putRecordLru(
        state.subagentTaskResults,
        key,
        nextTask,
        MAX_SUBAGENT_TASK_RESULTS,
      );
      const review = nextTask.review;
      const nextReviews =
        review === undefined
          ? state.subagentReviews
          : putRecordLru(
              state.subagentReviews,
              review.reviewId,
              preferSubagentReview(state.subagentReviews[review.reviewId], review),
              MAX_SUBAGENT_REVIEWS,
            );
      const record = nextTask.deliveryVerification;
      if (record === undefined) {
        return {
          ...state,
          subagentTaskResults: nextTaskResults,
          subagentReviews: nextReviews,
        };
      }
      const fact = verificationFactFromDelivery(record);
      const nextFact = preferSubagentVerification(
        state.subagentVerifications[fact.verificationId],
        fact,
      );
      return {
        ...state,
        subagentTaskResults: nextTaskResults,
        subagentReviews: nextReviews,
        subagentVerifications: putRecordLru(
          state.subagentVerifications,
          fact.verificationId,
          nextFact,
          MAX_SUBAGENT_VERIFICATIONS,
        ),
      };
    }
    case 'subagent/result-updated': {
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const current = state.subagentResults[action.result.resultId];
      if (current && current.revision >= action.result.revision) {
        return state;
      }
      const next = preferSubagentResult(current, action.result);
      return {
        ...state,
        subagentResults: evictCompletedFirst(
          {
            ...state.subagentResults,
            [next.resultId]: next,
          },
          MAX_SUBAGENT_RESULTS,
          isTerminalSubagentResult,
        ),
      };
    }
    case 'subagent/clear-stream': {
      if (!(action.childSessionId in state.subagentStreams)) {
        return state;
      }
      const nextStreams = { ...state.subagentStreams };
      delete nextStreams[action.childSessionId];
      return { ...state, subagentStreams: nextStreams };
    }
    default:
      return state;
  }
}

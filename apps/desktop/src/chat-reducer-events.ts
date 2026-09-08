import type { AgentEvent } from '@piwin/contracts';
import { mergeSearchEvidence } from '@piwin/contracts';
import { createBoundedTextAccumulator } from './bounded-text-accumulator';
import { ensureFailedRunAssistant, markLatestAssistantFailure } from './run-failure-message';
import type {
  ChatMessageUi,
  ChatUiAction,
  ChatUiState,
  CompactionActivityUi,
} from './chat-ui-types';
import { MAX_TOOL_CARDS_PER_MESSAGE } from './chat-ui-types';
import {
  STREAMING_TEXT_RETENTION_OPTIONS,
  STREAMING_THINKING_RETENTION_OPTIONS,
  appendBoundedLiveText,
  enforceBoundedTranscriptWindow,
  mapTranscriptMessagesToUi,
} from './chat-reducer-transcript';
import { applyCompactionEndContextUsage, applyUsageUpdate } from './chat-reducer-context';
import {
  isEnvelopeStale,
  isStaleByEnvelope,
  isStaleOptionalRunEvent,
  isUserControlInFlight,
  recordEnvelope,
  recordEventEnvelope,
  resolveAssistantModelFallback,
  withoutEmptyAssistantPlaceholders,
} from './chat-reducer-envelope';
import { removeSessionIdMarker, removeWorkingSessionId } from './chat-reducer-session-helpers';
import {
  appendBoundedToolOutput,
  appendGeneratedAttachmentsToToolOwner,
  createBoundedToolOutput,
  findAssistantMessageForToolStart,
  finishMessageThinking,
  mergeToolPresentation,
  projectBoundedToolPresentation,
  startMessageThinking,
  updateMessage,
  updateOwnedTool,
} from './chat-reducer-tools';
import {
  dequeuePermissionPrompt,
  enqueuePermissionPrompt,
  permissionQueueFields,
} from './permission-queue';

export type ChatUiEventAction = Extract<
  ChatUiAction,
  {
    type:
      'event' | 'event/batch' | 'compaction/dismiss' | 'reply-writer/updated' | 'transcript/append';
  }
>;

export function applyAgentEvent(state: ChatUiState, event: AgentEvent): ChatUiState {
  switch (event.type) {
    case 'message/start': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (event.role !== 'assistant') {
        return state;
      }
      // Host reconnects or duplicate SDK subscriptions may replay lifecycle
      // start events. A message id identifies one assistant bubble.
      const resolvedRunId = event.runId ?? state.activeRunId ?? undefined;
      const resolvedModel = event.model ?? resolveAssistantModelFallback(state);
      if (state.messages.some((message) => message.id === event.messageId)) {
        if (!resolvedModel) {
          return state;
        }
        return updateMessage(state, event.messageId, (message) =>
          message.model ? message : { ...message, model: resolvedModel },
        );
      }
      const controlInFlight = isUserControlInFlight(state);
      const message: ChatMessageUi = {
        id: event.messageId,
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'streaming',
        ...(resolvedRunId ? { runId: resolvedRunId } : {}),
        ...(resolvedModel ? { model: resolvedModel } : {}),
      };
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...withoutEmptyAssistantPlaceholders(state.messages), message],
        runPhase: controlInFlight ? state.runPhase : 'streaming',
        ...(event.runId
          ? {
              activeRunId: event.runId,
              activeRunPhase: controlInFlight ? state.activeRunPhase : ('streaming' as const),
            }
          : {}),
        streaming: !controlInFlight,
        runTerminal: { kind: 'none' },
      });
    }
    case 'message/text_delta':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        // Do not manufacture empty assistant rows for a delta whose lifecycle
        // start was lost or belongs to an older subscription.
        return state;
      }
      return updateMessage(state, event.messageId, (message) => {
        const nextMessage =
          event.delta.length > 0 ? finishMessageThinking(message, Date.now()) : message;
        const nextText = appendBoundedLiveText(
          {
            text: message.text,
            retainedBytes: message.textRetainedBytes,
            truncated: message.textTruncated,
          },
          event.delta,
          STREAMING_TEXT_RETENTION_OPTIONS,
        );
        return {
          ...nextMessage,
          text: nextText.text,
          textRetainedBytes: nextText.retainedBytes,
          textTruncated: nextText.truncated,
          ...(nextText.truncated || message.uiTruncated ? { uiTruncated: true } : {}),
          status: 'streaming',
        };
      });
    /** C1: complete text snapshot replaces, not appends. */
    case 'message/text_snapshot':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => {
        const nextMessage =
          event.text.length > 0 ? finishMessageThinking(message, Date.now()) : message;
        const boundedText = createBoundedTextAccumulator(
          event.text,
          STREAMING_TEXT_RETENTION_OPTIONS,
        );
        return {
          ...nextMessage,
          text: boundedText.text,
          textRetainedBytes: boundedText.retainedBytes,
          textTruncated: boundedText.truncated,
          ...(boundedText.truncated || message.uiTruncated ? { uiTruncated: true } : {}),
          status: message.status,
        };
      });
    case 'message/thinking_delta':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => {
        const nextMessage =
          event.delta.length > 0 ? startMessageThinking(message, Date.now()) : message;
        const nextThinking = appendBoundedLiveText(
          {
            text: message.thinking,
            retainedBytes: message.thinkingRetainedBytes,
            truncated: message.thinkingTruncated,
          },
          event.delta,
          STREAMING_THINKING_RETENTION_OPTIONS,
        );
        return {
          ...nextMessage,
          thinking: nextThinking.text,
          thinkingRetainedBytes: nextThinking.retainedBytes,
          thinkingTruncated: nextThinking.truncated,
          ...(nextThinking.truncated || message.uiTruncated ? { uiTruncated: true } : {}),
        };
      });
    case 'message/tool_args_progress': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => {
        if (message.tools.length > 0) {
          return message;
        }
        const nextMessage = finishMessageThinking(message, Date.now());
        return {
          ...nextMessage,
          toolArgsProgress: {
            argumentCharCount: event.argumentCharCount,
            ...(event.toolName !== undefined ? { toolName: event.toolName } : {}),
          },
        };
      });
    }
    case 'message/search_evidence': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        searchEvidence: mergeSearchEvidence(message.searchEvidence, event.evidence),
      }));
    }
    case 'message/end': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const fallbackModel = resolveAssistantModelFallback(state);
      const next = updateMessage(state, event.messageId, (message) => ({
        ...finishMessageThinking(message, Date.now()),
        status: 'done' as const,
        // After streaming, Conversation stops using livePromptModel. If Host
        // omitted the snapshot on message/start, keep the turn/session model
        // so the provider avatar does not disappear on completion.
        ...(message.model === undefined && fallbackModel !== undefined
          ? { model: fallbackModel }
          : {}),
      }));
      // Pi ends the Assistant row that carries a tool call before
      // tool_execution_start. Keep that empty row so tool/start can attach;
      // ChatMessageRow hides it, and the next assistant message/start prunes
      // leftovers that never received tools (see store-transcript-recorder).
      const hasRunningTool = next.messages.some((message) =>
        message.tools.some((tool) => tool.status === 'running'),
      );
      if (event.runId !== undefined || state.activeRunId !== null) {
        const controlInFlight = isUserControlInFlight(state);
        return enforceBoundedTranscriptWindow({
          ...next,
          activeRunPhase: controlInFlight
            ? state.activeRunPhase
            : hasRunningTool
              ? 'tool-running'
              : (state.activeRunPhase ?? 'streaming'),
          runPhase: controlInFlight
            ? state.runPhase
            : state.runPhase === 'idle'
              ? 'streaming'
              : state.runPhase,
          streaming: !controlInFlight,
        });
      }
      return enforceBoundedTranscriptWindow({
        ...next,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        activeSkill: null,
        runTerminal: hasRunningTool ? next.runTerminal : { kind: 'complete', at: Date.now() },
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
        // Legacy events without a runId are accepted only for the active
        // session, whose completed response is already visible in the window.
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          state.activeSessionId,
        ),
        failedAttentionSessionIds: removeSessionIdMarker(
          state.failedAttentionSessionIds,
          state.activeSessionId,
        ),
      });
    }
    case 'session/aborted': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const messageId = event.messageId;
      const thinkingEndedAt = Date.now();
      const nextMessages = messageId
        ? state.messages.map((message) =>
            message.id === messageId
              ? {
                  ...finishMessageThinking(message, thinkingEndedAt),
                  status: 'done' as const,
                }
              : message,
          )
        : state.messages.map((message) =>
            message.status === 'streaming'
              ? {
                  ...finishMessageThinking(message, thinkingEndedAt),
                  status: 'done' as const,
                }
              : message,
          );
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: nextMessages,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: event.runId ?? null,
        streaming: false,
        activeSkill: null,
        runTerminal: { kind: 'stopped', at: Date.now() },
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
      });
    }
    case 'tool/start': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const ownerMessage = findAssistantMessageForToolStart(
        state,
        event.runId,
        event.responseMessageId,
      );
      if (!ownerMessage) {
        return state;
      }
      return updateMessage(state, ownerMessage.id, (message) => {
        if (message.tools.length >= MAX_TOOL_CARDS_PER_MESSAGE) {
          // Card budget exhausted: skip this card rather than grow a
          // protected live message without bound.
          return message;
        }
        const output = createBoundedToolOutput(event.presentation?.output?.text ?? '');
        const finished = finishMessageThinking(message, Date.now());
        const { toolArgsProgress: _clearedProgress, ...withoutToolArgsProgress } = finished;
        return {
          ...withoutToolArgsProgress,
          tools: [
            ...message.tools,
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status: 'running',
              output: output.text,
              outputRetainedBytes: output.retainedBytes,
              outputTruncated: output.truncated,
              ...(event.presentation
                ? {
                    presentation: projectBoundedToolPresentation(event.presentation, output),
                  }
                : {}),
              ...(event.runId ? { runId: event.runId } : {}),
              ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
            },
          ],
        };
      });
    }
    case 'tool/update':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      return updateOwnedTool(
        state,
        event.toolCallId,
        event.runId,
        event.responseMessageId,
        (tool) => {
          const output =
            event.presentation?.output?.text !== undefined
              ? createBoundedToolOutput(event.presentation.output.text)
              : appendBoundedToolOutput(tool, event.delta);
          const mergedPresentation = event.presentation
            ? mergeToolPresentation(tool.presentation, event.presentation)
            : tool.presentation;
          return {
            ...tool,
            output: output.text,
            outputRetainedBytes: output.retainedBytes,
            outputTruncated: output.truncated,
            ...(mergedPresentation
              ? { presentation: projectBoundedToolPresentation(mergedPresentation, output) }
              : {}),
            ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
          };
        },
      );
    case 'tool/end':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      {
        const updatedState = updateOwnedTool(
          state,
          event.toolCallId,
          event.runId,
          event.responseMessageId,
          (tool) => {
            const mergedPresentation = event.presentation
              ? mergeToolPresentation(tool.presentation, event.presentation)
              : tool.presentation;
            const displayOutput =
              mergedPresentation?.output?.text !== undefined
                ? mergedPresentation.output.text
                : tool.output;
            const output = createBoundedToolOutput(displayOutput);
            return {
              ...tool,
              status: event.isError ? 'error' : 'done',
              output: output.text,
              outputRetainedBytes: output.retainedBytes,
              outputTruncated: output.truncated,
              ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
              ...(mergedPresentation
                ? { presentation: projectBoundedToolPresentation(mergedPresentation, output) }
                : {}),
            };
          },
        );
        if (!event.attachments || event.attachments.length === 0) {
          return updatedState;
        }
        return appendGeneratedAttachmentsToToolOwner(
          updatedState,
          event.toolCallId,
          event.runId,
          event.responseMessageId,
          event.attachments,
        );
      }
    case 'permission/request': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      // Normalized event path (in addition to HostPush permission/request).
      // sessionId is not on AgentEvent; bind to the active session.
      if (!state.activeSessionId) {
        return state;
      }
      {
        const nextQueue = enqueuePermissionPrompt(state.permissionQueue, {
          requestId: event.requestId,
          sessionId: state.activeSessionId,
          action: event.action,
          detail: event.detail,
          defaultDecision: event.defaultDecision,
          ...(event.runId ? { runId: event.runId } : {}),
          ...(event.context ? { context: event.context } : {}),
        });
        if (nextQueue === state.permissionQueue) {
          return state;
        }
        return { ...state, ...permissionQueueFields(nextQueue) };
      }
    }
    case 'permission/resolved': {
      const nextQueue = dequeuePermissionPrompt(state.permissionQueue, event.requestId);
      if (nextQueue === state.permissionQueue) {
        return state;
      }
      return { ...state, ...permissionQueueFields(nextQueue) };
    }
    case 'compaction/start':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      {
        const startedAt = Date.now();
        const runId = event.runId ?? state.activeRunId ?? undefined;
        const operationId =
          event.operationId ?? `compaction:${state.activeSessionId ?? 'session'}:${startedAt}`;
        const activity: CompactionActivityUi = {
          operationId,
          phase: 'running',
          reason: event.reason ?? 'unknown',
          anchorMessageId: state.messages.at(-1)?.id ?? null,
          startedAt,
          ...(runId !== undefined ? { runId } : {}),
        };
        return {
          ...state,
          compacting: true,
          compactionActivity: activity,
          lastCompactionMessage: null,
          lastCompactionSummary: null,
          lastCompactionTokensBefore: null,
          lastCompactionTokensAfter: null,
          lastCompactionDurationMs: null,
          lastCompactionFileOps: null,
        };
      }
    case 'compaction/end': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (event.noOp) {
        // Pi emits start/end even when manual compact finds no eligible
        // history. Do not leave a transient no-op as a red terminal card.
        if (!state.compacting && state.compactionActivity?.phase !== 'running') {
          return state;
        }
        return {
          ...state,
          compacting: false,
          compactionActivity: null,
          lastCompactionMessage: null,
          lastCompactionSummary: null,
          lastCompactionTokensBefore: null,
          lastCompactionTokensAfter: null,
          lastCompactionDurationMs: null,
          lastCompactionFileOps: null,
        };
      }
      const message =
        typeof event.message === 'string' && event.message
          ? event.message
          : event.ok === false
            ? 'Compaction finished with errors'
            : 'Context compacted';
      const fileOps = 'fileOps' in event && event.fileOps ? event.fileOps : null;
      const contextUsage = applyCompactionEndContextUsage(state.contextUsage, event);
      const previousActivity = state.compactionActivity;
      const startedAt = previousActivity?.startedAt ?? Date.now();
      const runId = event.runId ?? previousActivity?.runId ?? state.activeRunId ?? undefined;
      const operationId =
        event.operationId ?? previousActivity?.operationId ?? `compaction:${startedAt}`;
      const activity: CompactionActivityUi = {
        operationId,
        phase: event.aborted === true ? 'cancelled' : event.ok === false ? 'failed' : 'succeeded',
        reason: event.reason ?? previousActivity?.reason ?? 'unknown',
        anchorMessageId: previousActivity?.anchorMessageId ?? state.messages.at(-1)?.id ?? null,
        startedAt,
        endedAt: Date.now(),
        ...(runId !== undefined ? { runId } : {}),
        ...(message ? { message } : {}),
        ...(typeof event.summary === 'string' && event.summary ? { summary: event.summary } : {}),
        ...(typeof event.tokensBefore === 'number' ? { tokensBefore: event.tokensBefore } : {}),
        ...(typeof event.tokensAfter === 'number' ? { tokensAfter: event.tokensAfter } : {}),
        ...(typeof event.durationMs === 'number' ? { durationMs: event.durationMs } : {}),
        ...(fileOps ? { fileOps } : {}),
        ...(event.willRetry === true ? { willRetry: true } : {}),
      };
      return {
        ...state,
        contextUsage,
        compacting: false,
        compactionActivity: activity,
        lastCompactionMessage: message,
        lastCompactionSummary:
          typeof event.summary === 'string' && event.summary ? event.summary : null,
        lastCompactionTokensBefore:
          typeof event.tokensBefore === 'number' ? event.tokensBefore : null,
        lastCompactionTokensAfter: typeof event.tokensAfter === 'number' ? event.tokensAfter : null,
        lastCompactionDurationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
        lastCompactionFileOps: fileOps,
      };
    }
    case 'usage/update':
      return applyUsageUpdate(state, event.usage);
    case 'model/retry':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (isUserControlInFlight(state) || event.phase === 'finished') {
        return state;
      }
      return {
        ...state,
        ...(event.runId !== undefined ? { activeRunId: event.runId } : {}),
        activeRunPhase: 'connecting-model',
        runPhase: 'streaming',
        streaming: true,
      };
    case 'error':
      // Evidence only. Run terminal status comes from run/terminal.
      if (event.runId === undefined) {
        return state;
      }
      if (state.activeRunId !== null && state.activeRunId !== event.runId) {
        return state;
      }
      if (
        state.activeRunId === null &&
        state.lastTerminalRunId !== null &&
        state.lastTerminalRunId !== event.runId
      ) {
        return state;
      }
      {
        const errorMessage = event.message.trim() || 'Run failed';
        const targetRunId = event.runId;
        const controlInFlight = isUserControlInFlight(state);
        if (controlInFlight) {
          return {
            ...state,
            error: null,
            streaming: false,
            compacting: false,
            activeSkill: null,
            workingSessionIds: removeWorkingSessionId(
              state.workingSessionIds,
              state.activeSessionId,
            ),
          };
        }
        const lastOutcome = state.runRecordsById[targetRunId]?.outcome;
        if (lastOutcome === 'cancelled' || lastOutcome === 'paused') {
          return state;
        }
        const runAlreadyFailed =
          state.activeRunId === null &&
          state.lastTerminalRunId === targetRunId &&
          lastOutcome === 'failed';
        const failureProjection = markLatestAssistantFailure(
          state.messages,
          targetRunId,
          errorMessage,
          true,
          false,
          {
            ...(event.failure === undefined ? {} : { failure: event.failure }),
            stampStatus: runAlreadyFailed,
          },
        );
        return {
          ...state,
          messages: failureProjection.stamped
            ? failureProjection.messages
            : ensureFailedRunAssistant(
                state.messages,
                targetRunId,
                errorMessage,
                event.failure === undefined ? undefined : { failure: event.failure },
              ),
        };
      }
    default:
      return state;
  }
}

export function reduceChatEvents(state: ChatUiState, action: ChatUiEventAction): ChatUiState {
  switch (action.type) {
    case 'compaction/dismiss':
      return {
        ...state,
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
      };
    case 'reply-writer/updated': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      if (!state.messages.some((message) => message.id === action.messageId)) {
        return state;
      }
      return updateMessage(state, action.messageId, (message) => {
        if (action.status === 'started') {
          return { ...message, replyWriterPending: true };
        }
        if (action.status === 'failed') {
          return { ...message, replyWriterPending: false };
        }
        return {
          ...message,
          replyWriterPending: false,
          ...(action.model && action.language
            ? { replyWriter: { model: action.model, language: action.language } }
            : {}),
        };
      });
    }
    case 'transcript/append': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      if (state.messages.some((item) => item.id === action.message.id)) {
        if (!action.message.model) {
          return state;
        }
        return {
          ...state,
          messages: state.messages.map((item) => {
            if (item.id === action.message.id && !item.model && action.message.model) {
              return {
                ...item,
                model: action.message.model,
                ...(action.message.createdAt && !item.createdAt
                  ? { createdAt: action.message.createdAt }
                  : {}),
              };
            }
            return item;
          }),
        };
      }
      const [nextMessage] = mapTranscriptMessagesToUi([action.message], {
        keepStreamingStatus: true,
      });
      if (!nextMessage) {
        return state;
      }
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...state.messages, nextMessage],
        userMessageIndex:
          action.message.role === 'user' &&
          typeof action.message.text === 'string' &&
          action.message.text.trim().length > 0
            ? null
            : state.userMessageIndex,
        userMessageIndexEpoch:
          action.message.role === 'user' &&
          typeof action.message.text === 'string' &&
          action.message.text.trim().length > 0
            ? state.userMessageIndexEpoch + 1
            : state.userMessageIndexEpoch,
      });
    }
    case 'event':
      if (state.activeSessionId !== action.sessionId || state.awaitingTranscript) {
        return state;
      }
      if (isStaleByEnvelope(state, action)) {
        return state;
      }
      return applyAgentEvent(recordEventEnvelope(state, action), action.event);
    case 'event/batch': {
      if (state.activeSessionId !== action.sessionId || state.awaitingTranscript) {
        return state;
      }
      // C1: process batch events individually, checking each for envelope staleness
      let currentState = state;
      const envelopes = action.envelopes ?? [];
      for (let index = 0; index < action.events.length; index++) {
        const batchEvent = action.events[index];
        if (!batchEvent) {
          continue;
        }
        const batchEnvelope = envelopes[index];
        if (batchEnvelope && isEnvelopeStale(currentState, batchEnvelope)) {
          continue;
        }
        if (batchEnvelope) {
          currentState = recordEnvelope(currentState, batchEnvelope);
        }
        currentState = applyAgentEvent(currentState, batchEvent);
      }
      return currentState;
    }
    default:
      return state;
  }
}

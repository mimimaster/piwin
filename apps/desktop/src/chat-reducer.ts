import type { WalkthroughArtifact } from '@piwin/contracts';
import { createSessionListScopeState } from './session-list-scope';
import { createEmptyWarmSessionCache } from './session-warm-cache';
import { createInitialContextTelemetryState, applyContextTelemetry } from './context-telemetry-reducer';
import type { ChatUiAction, ChatUiState } from './chat-ui-types';
import { refreshActiveSessionMetadata } from './chat-reducer-session-helpers';
import { reduceChatSession } from './chat-reducer-session';
import { reduceChatSessionList } from './chat-reducer-session-list';
import { reduceChatRun } from './chat-reducer-run';
import { reduceChatEvents } from './chat-reducer-events';
import { reduceChatSubagent } from './chat-reducer-subagent';
import { isStaleRunEvent } from './chat-reducer-envelope';
import {
  dequeuePermissionPrompt,
  enqueuePermissionPrompt,
  permissionQueueFields,
  reconcilePermissionQueue,
} from './permission-queue';

export type {
  ChatMessageUi,
  ChatUiAction,
  ChatUiState,
  CompactionActivityUi,
  PermissionPromptUi,
  RunRecordUi,
  RunTerminalState,
  SessionListItemUi,
  SkillActivityView,
  SubagentStreamSegment,
  SubagentStreamState,
  SubagentStreamTool,
  ToolCardUi,
  TranscriptHistoryViewUi,
} from './chat-ui-types';
export {
  MAX_RETAINED_SUBAGENT_SEGMENT_TEXT_BYTES,
  MAX_RETAINED_SUBAGENT_SEGMENT_THINKING_BYTES,
  MAX_SUBAGENT_STREAM_SEGMENTS,
  MAX_TOOL_CARDS_PER_MESSAGE,
} from './chat-ui-types';
export {
  MAX_LIVE_ASSISTANT_TEXT_BYTES,
  MAX_LIVE_THINKING_BYTES,
  STREAMING_TEXT_RETENTION_OPTIONS,
  STREAMING_TEXT_TRUNCATION_MARKER,
  STREAMING_THINKING_RETENTION_OPTIONS,
  STREAMING_THINKING_TRUNCATION_MARKER,
  appendBoundedLiveText,
  calculateUtf8ByteLength,
  mapTranscriptMessagesToUi,
} from './chat-reducer-transcript';

export function createInitialChatUiState(): ChatUiState {
  return {
    activeScope: { kind: 'general' },
    projectPath: null,
    projectTrusted: false,
    trustDialogOpen: false,
    sessions: [],
    generalSessions: [],
    /** Per-project session lists for the sidebar folder tree. Kept independent
     *  from `sessions` (the active scope's list) so any number of project
     *  folders can stay open with their own conversations visible. */
    projectSessionsByPath: {},
    sessionListScopes: createSessionListScopeState(),
    sessionEntitiesById: {},
    sessionTombstonesById: {},
    activeSessionId: null,
    messages: [],
    warmSessionCache: createEmptyWarmSessionCache(),
    transcriptWindow: null,
    historyView: null,
    userMessageIndex: null,
    userMessageIndexEpoch: 0,
    queuedTurnsBySession: {},
    queuedTurnQueueRevisions: {},
    outline: [],
    activeSessionArchived: false,
    awaitingTranscript: false,
    transcriptOwnerSessionId: null,
    activeSessionMetadata: null,
    sessionListMutationEpoch: 0,
    runPhase: 'idle',
    /**
     * Host-owned selected-session admission. Send/run controls stay off while
     * unknown or reconciling so a false idle cannot issue if-idle.
     */
    foregroundAdmission: 'unknown' as const,
    activeRunId: null,
    activeRunPhase: null,
    activeRunPhaseDetail: null,
    activeRunStartedAt: null,
    activeRunPhaseUpdatedAt: null,
    lastTerminalRunId: null,
    streaming: false,
    runTerminal: { kind: 'none' },
    compacting: false,
    compactionActivity: null,
    hostReady: false,
    hostMock: true,
    permissionPrompt: null,
    permissionQueue: [],
    activeSkill: null,
    error: null,
    lastCompactionMessage: null,
    lastCompactionSummary: null,
    lastCompactionTokensBefore: null,
    lastCompactionTokensAfter: null,
    lastCompactionDurationMs: null,
    lastCompactionFileOps: null,
    contextUsage: null,
    contextTelemetry: createInitialContextTelemetryState(),
    receivedEventIds: new Set<string>(),
    lastAcceptedSequenceByRun: {},
    runRecordsById: {},
    subagentStreams: {},
    subagentChildren: {},
    subagentInvocations: {},
    subagentBatches: {},
    subagentTaskResults: {},
    walkthroughsByMessageId: {},
    workingSessionIds: {},
    completedAttentionSessionIds: {},
    pendingTurnModel: null,
  };
}

function chatUiReducerCore(state: ChatUiState, action: ChatUiAction): ChatUiState {
  switch (action.type) {
    case 'scope/set':
    case 'project/set':
    case 'project/clear':
    case 'project/trust-dialog':
    case 'project/trusted':
    case 'session/set':
    case 'session/load-messages':
    case 'session/prepend-messages':
    case 'session/seek-messages':
    case 'session/user-message-index':
    case 'session/return-to-live':
    case 'session/hydrate':
    case 'session/hydrate-scope':
    case 'session/hydrate-error':
    case 'session/hydrate-project':
    case 'session/retain-project-paths':
    case 'session/hydrate-general':
    case 'session/clear-active':
    case 'session/branch-switched':
      return reduceChatSession(state, action);
    case 'session/add':
    case 'session/update':
    case 'session/remove':
    case 'session/mark-archived-active':
    case 'session/hide-from-list':
    case 'session/queued-turns-hydrate':
    case 'session/queued-turn-updated':
    case 'session/attention-dismiss':
      return reduceChatSessionList(state, action);
    case 'user/send':
    case 'user/steer':
    case 'user/send-rollback':
    case 'run/pausing':
    case 'run/pause-failed':
    case 'run/aborting':
    case 'run/abort-failed':
    case 'run/accepted':
    case 'run/updated':
    case 'run/terminal':
    case 'run/stale-clear':
    case 'run/intervention-updated':
    case 'run/terminal-dismiss':
    case 'foreground/admission':
      return reduceChatRun(state, action);
    case 'event':
    case 'event/batch':
    case 'compaction/dismiss':
    case 'reply-writer/updated':
    case 'transcript/append':
      return reduceChatEvents(state, action);
    case 'subagent/stream':
    case 'subagent/updated':
    case 'subagent/invocation-updated':
    case 'subagent/children-hydrate':
    case 'subagent/invocations-hydrate':
    case 'subagent/batch-updated':
    case 'subagent/task-updated':
    case 'subagent/clear-stream':
      return reduceChatSubagent(state, action);

    case 'host/status':
      return {
        ...state,
        hostReady: action.ready,
        hostMock: action.mock,
        foregroundAdmission: action.ready ? state.foregroundAdmission : 'unknown',
        contextTelemetry: applyContextTelemetry(
          state.contextTelemetry,
          action.ready ? { type: 'reconnect' } : { type: 'disconnect' },
        ),
      };
    case 'context-telemetry/snapshot':
      return {
        ...state,
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, {
          type: 'snapshot',
          snapshot: action.snapshot,
          source: action.source ?? 'live',
          awaitingTranscript: state.awaitingTranscript,
          ...(action.hostInstanceId !== undefined
            ? { hostInstanceId: action.hostInstanceId }
            : {}),
        }),
      };
    case 'context-telemetry/last-request':
      return {
        ...state,
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, {
          type: 'last-request',
          sessionId: action.sessionId,
          usage: action.usage,
        }),
      };
    case 'context-telemetry/capability':
      return {
        ...state,
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, {
          type: 'capability',
          supported: action.supported,
        }),
      };
    case 'context-telemetry/disconnect':
      return {
        ...state,
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, { type: 'disconnect' }),
      };
    case 'context-telemetry/reconnect':
      return {
        ...state,
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, { type: 'reconnect' }),
      };
    case 'context-telemetry/host-instance':
      return {
        ...state,
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, {
          type: 'host-instance',
          hostInstanceId: action.hostInstanceId,
        }),
      };
    case 'context-telemetry/invalidate':
      return {
        ...state,
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, {
          type: 'invalidate',
          sessionId: action.sessionId,
        }),
      };
    case 'permission/show':
      if (action.prompt.runId !== undefined && isStaleRunEvent(state, action.prompt.runId)) {
        return state;
      }
      {
        const nextQueue = enqueuePermissionPrompt(state.permissionQueue, action.prompt);
        if (nextQueue === state.permissionQueue) {
          return state;
        }
        return { ...state, ...permissionQueueFields(nextQueue) };
      }
    case 'permission/clear':
      // A resolve response can arrive after the host has already emitted the
      // next MCP permission prompt. Clear only the prompt this response settled.
      {
        const nextQueue = dequeuePermissionPrompt(state.permissionQueue, action.requestId);
        if (nextQueue === state.permissionQueue) {
          return state;
        }
        return { ...state, ...permissionQueueFields(nextQueue) };
      }
    case 'permission/reconcile': {
      const nextQueue = reconcilePermissionQueue(state.permissionQueue, action.permissions);
      if (nextQueue === state.permissionQueue) {
        return state;
      }
      return { ...state, ...permissionQueueFields(nextQueue) };
    }
    case 'error':
      return {
        ...state,
        error: action.message,
        activeSkill: null,
        ...(state.activeRunId === null ? { runPhase: 'idle' as const, streaming: false } : {}),
      };
    case 'error/clear':
      return state.error === null ? state : { ...state, error: null };
    case 'walkthrough/hydrate': {
      // While the previous session's rows are still painted, ignore hydrate so
      // walkthrough chips cannot attach to the wrong transcript.
      if (state.awaitingTranscript) {
        return state;
      }
      const walkthroughsByMessageId: Record<string, WalkthroughArtifact> = {};
      for (const artifact of action.artifacts) {
        walkthroughsByMessageId[artifact.messageId] = artifact;
      }
      return { ...state, walkthroughsByMessageId };
    }
    case 'walkthrough/updated': {
      // Cross-session guard: a walkthrough generation that completes for
      // session B must not leak into session A's map after the user has
      // switched away. Only accept pushes for the active session.
      if (state.activeSessionId !== action.artifact.sessionId) return state;
      const existing = state.walkthroughsByMessageId[action.artifact.messageId];
      // Only drop a `generating` push when a *different* generation is still
      // in flight — that is a stale late push from an old generation. A
      // `generating` push against a terminal (ready/error) artifact represents
      // a fresh regeneration request (e.g. the user clicked Regenerate) and
      // must be accepted so the UI shows "Generating...". Terminal pushes
      // (ready/error) always update.
      if (
        existing &&
        existing.status === 'generating' &&
        action.artifact.status === 'generating' &&
        existing.generationId !== action.artifact.generationId
      ) {
        return state;
      }
      return {
        ...state,
        walkthroughsByMessageId: {
          ...state.walkthroughsByMessageId,
          [action.artifact.messageId]: action.artifact,
        },
      };
    }
    case 'walkthrough/remove': {
      if (!(action.messageId in state.walkthroughsByMessageId)) {
        return state;
      }
      const nextWalkthroughs = { ...state.walkthroughsByMessageId };
      delete nextWalkthroughs[action.messageId];
      return { ...state, walkthroughsByMessageId: nextWalkthroughs };
    }
    default:
      return state;
  }
}

export function chatUiReducer(state: ChatUiState, action: ChatUiAction): ChatUiState {
  const next = chatUiReducerCore(state, action);
  if (next === state) {
    return state;
  }
  return refreshActiveSessionMetadata(state, next);
}

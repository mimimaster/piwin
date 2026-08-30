import { isPlaceholderSessionName } from './title-display';
import { setSessionListScopeMeta } from './session-list-scope';
import { retainRecordKeys } from './record-budget';
import {
  measureTranscriptCacheBytes,
  prependBoundedTranscriptPage,
  retainBoundedTranscriptWindow,
} from './transcript-page-cache';
import {
  getWarmSessionSnapshot,
  putWarmSessionSnapshot,
  removeWarmSessionSnapshot,
} from './session-warm-cache';
import type { ChatUiAction, ChatUiState } from './chat-ui-types';
import {
  CLEARED_SUBAGENT_UI,
  dedupeSessionsById,
  removeSessionIdMarker,
  removeWorkingSessionId,
} from './chat-reducer-session-helpers';
import {
  buildRunRecordsFromTranscriptMessages,
  collectRetainedTranscriptMessageIds,
  enforceBoundedTranscriptWindow,
  mapTranscriptMessagesToUi,
  mergeRefreshedTailWithLiveMessages,
} from './chat-reducer-transcript';
import { contextUsageForLoadMessages, contextUsageForSessionSet } from './chat-reducer-context';
import { applyContextTelemetry } from './context-telemetry-reducer';

export type ChatUiSessionSelectionAction = Extract<
  ChatUiAction,
  {
    type:
      | 'scope/set'
      | 'project/set'
      | 'project/clear'
      | 'project/trust-dialog'
      | 'project/trusted'
      | 'session/set'
      | 'session/load-messages'
      | 'session/prepend-messages'
      | 'session/seek-messages'
      | 'session/user-message-index'
      | 'session/return-to-live'
      | 'session/hydrate'
      | 'session/hydrate-scope'
      | 'session/hydrate-project'
      | 'session/retain-project-paths'
      | 'session/hydrate-general'
      | 'session/clear-active'
      | 'session/branch-switched';
  }
>;

export function reduceChatSession(
  state: ChatUiState,
  action: ChatUiSessionSelectionAction,
): ChatUiState {
  switch (action.type) {
    case 'scope/set':
      if (action.scope.kind === 'general' && state.activeScope.kind === 'general') {
        return state;
      }
      if (
        action.scope.kind === 'project' &&
        state.activeScope.kind === 'project' &&
        action.scope.projectPath === state.activeScope.projectPath
      ) {
        return state;
      }
      return {
        ...state,
        activeScope: action.scope,
        // Switching scope clears the visible session list; hydrate reloads it.
        sessions: [],
        // Keep the live session identity so composer snapshots see A→B, not
        // a fake New Agent gap. Transcript paint is cleared below.
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    case 'project/set':
      return {
        ...state,
        activeScope: { kind: 'project', projectPath: action.path },
        projectPath: action.path,
        projectTrusted: action.trusted,
        trustDialogOpen: !action.trusted,
        // A project owns its own history. Do not leave another project's rows or
        // transcript visible while the new project's session index is loading.
        // Keep activeSessionId: composer must not treat this as New Agent.
        sessions: [],
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        // Subagent activity is scoped to the active parent session; switching
        // scope must not surface another session's children or live streams.
        ...CLEARED_SUBAGENT_UI,
      };
    case 'project/clear':
      return {
        ...state,
        activeScope: { kind: 'general' },
        projectPath: null,
        projectTrusted: false,
        trustDialogOpen: false,
        sessions: [],
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    case 'project/trust-dialog':
      return { ...state, trustDialogOpen: action.open };
    case 'project/trusted':
      return { ...state, projectTrusted: true, trustDialogOpen: false };
    case 'session/set': {
      // Paint-first first send: draft mode may already show an optimistic user
      // bubble before session/create returns. Activating that new session must
      // keep the bubble instead of wiping the transcript.
      const preserveOptimisticDraftSend =
        state.activeSessionId === null &&
        state.streaming === true &&
        state.messages.length > 0 &&
        state.messages.every((message) => message.role === 'user');
      // Explicit opt-in from handleResumeSession only. session/create → session/set
      // must NOT await (no load-messages follows; events/walkthrough would stall).
      const awaitingTranscript = !preserveOptimisticDraftSend && action.awaitTranscript === true;
      const switchingAway =
        state.activeSessionId !== null && state.activeSessionId !== action.sessionId;

      // Stash the session we leave into the inactive warm LRU (message JSON only).
      let warmSessionCache = state.warmSessionCache;
      if (switchingAway && state.messages.length > 0 && state.activeSessionId) {
        warmSessionCache = putWarmSessionSnapshot(warmSessionCache, {
          sessionId: state.activeSessionId,
          messages: state.messages,
          transcriptWindow: state.transcriptWindow,
          outline: state.outline,
          runRecordsById: state.runRecordsById,
          walkthroughsByMessageId: state.walkthroughsByMessageId,
          contextUsage: state.contextUsage,
        });
      }

      const warmHit =
        switchingAway || state.activeSessionId === null
          ? getWarmSessionSnapshot(warmSessionCache, action.sessionId)
          : null;
      // Promote warm → active: drop the inactive slot so we do not hold two
      // copies of the same session's rows. On next leave, putWarm stashes again.
      if (warmHit) {
        warmSessionCache = removeWarmSessionSnapshot(warmSessionCache, action.sessionId);
      }

      // Paint policy while Host resume is in flight:
      // 1) warm hit → that session's rows (correct id)
      // 2) cold + awaiting → keep previous rows under a loading banner (no empty flash)
      // 3) else → empty
      // Stream events stay ignored while awaitingTranscript is true.
      const keepPreviousWhileLoading = !warmHit && awaitingTranscript && state.messages.length > 0;
      // Owner follows the painted rows: new session for fresh/warm paint,
      // the previous owner while old rows stay visible under the loading banner.
      const transcriptOwnerSessionId =
        keepPreviousWhileLoading && switchingAway
          ? (state.transcriptOwnerSessionId ?? state.activeSessionId)
          : action.sessionId;

      return {
        ...state,
        activeSessionId: action.sessionId,
        warmSessionCache,
        pendingTurnModel: switchingAway ? null : state.pendingTurnModel,
        messages: preserveOptimisticDraftSend
          ? state.messages
          : warmHit
            ? warmHit.messages
            : keepPreviousWhileLoading
              ? state.messages
              : [],
        transcriptWindow: warmHit
          ? warmHit.transcriptWindow
          : keepPreviousWhileLoading
            ? state.transcriptWindow
            : null,
        historyView: null,
        userMessageIndex:
          preserveOptimisticDraftSend || state.activeSessionId === action.sessionId
            ? state.userMessageIndex
            : null,
        userMessageIndexEpoch:
          state.activeSessionId === action.sessionId
            ? state.userMessageIndexEpoch
            : state.userMessageIndexEpoch + 1,
        runPhase: preserveOptimisticDraftSend ? state.runPhase : 'idle',
        foregroundAdmission: preserveOptimisticDraftSend ? 'ready' : 'reconciling',
        activeRunId: preserveOptimisticDraftSend ? state.activeRunId : null,
        activeRunPhase: preserveOptimisticDraftSend ? state.activeRunPhase : null,
        activeRunPhaseDetail: preserveOptimisticDraftSend ? state.activeRunPhaseDetail : null,
        activeRunStartedAt: preserveOptimisticDraftSend ? state.activeRunStartedAt : null,
        lastTerminalRunId: null,
        streaming: preserveOptimisticDraftSend ? true : false,
        activeSkill: preserveOptimisticDraftSend ? state.activeSkill : null,
        outline: warmHit ? warmHit.outline : keepPreviousWhileLoading ? state.outline : [],
        activeSessionArchived: false,
        awaitingTranscript,
        transcriptOwnerSessionId,
        runTerminal: { kind: 'none' },
        // C1: clear event id ring for the new session
        receivedEventIds: new Set<string>(),
        lastAcceptedSequenceByRun: {},
        runRecordsById: warmHit
          ? warmHit.runRecordsById
          : keepPreviousWhileLoading
            ? state.runRecordsById
            : {},
        walkthroughsByMessageId: warmHit
          ? warmHit.walkthroughsByMessageId
          : keepPreviousWhileLoading
            ? state.walkthroughsByMessageId
            : {},
        contextUsage: contextUsageForSessionSet({
          warmHit,
          keepPreviousWhileLoading,
          activeSessionId: state.activeSessionId,
          nextSessionId: action.sessionId,
          current: state.contextUsage,
        }),
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, {
          type: 'select',
          sessionId: action.sessionId,
        }),
        // Subagent activity belongs to the previously active parent; the new
        // session hydrates its own children on resume.
        ...CLEARED_SUBAGENT_UI,
        workingSessionIds: preserveOptimisticDraftSend
          ? { ...state.workingSessionIds, [action.sessionId]: true }
          : state.workingSessionIds,
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          action.sessionId,
        ),
      };
    }
    case 'session/load-messages': {
      // User selection is the activation authority. A late resume must not
      // revive messages/model/occupancy after New (activeSessionId === null)
      // or after switching away.
      if (state.activeSessionId === null || state.activeSessionId !== action.sessionId) {
        return state;
      }
      // Session hydration can race the foreground-run admission query. A
      // Host-confirmed active Run is authoritative for the composer, so a
      // transcript read must not turn Stop back into Send while replacing
      // the visible history.
      const preserveRunProjection = action.preserveActiveTail || state.activeRunId !== null;
      const hasConfirmedActiveRun = state.activeRunId !== null;
      const refreshedMessages = mapTranscriptMessagesToUi(action.messages);
      const candidateMessages = action.preserveActiveTail
        ? mergeRefreshedTailWithLiveMessages(refreshedMessages, state.messages, state.streaming)
        : refreshedMessages;
      const bounded = retainBoundedTranscriptWindow(
        candidateMessages,
        collectRetainedTranscriptMessageIds(candidateMessages, state.streaming),
      );
      const messages = bounded.messages;
      const retainedMessageIds = new Set(messages.map((message) => message.id));
      const hydratedRunRecords = buildRunRecordsFromTranscriptMessages(
        action.messages.filter((message) => retainedMessageIds.has(message.id)),
      );
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages,
        historyView: null,
        transcriptWindow: action.transcriptPage
          ? {
              revision: action.transcriptPage.revision,
              totalCount: action.transcriptPage.totalCount,
              ...(!bounded.cacheLimitReached && action.transcriptPage.olderCursor
                ? { olderCursor: action.transcriptPage.olderCursor }
                : {}),
              retainedBytes: bounded.retainedBytes,
              cacheLimitReached: bounded.cacheLimitReached,
            }
          : null,
        runPhase: preserveRunProjection ? state.runPhase : 'idle',
        activeRunId: preserveRunProjection ? state.activeRunId : null,
        activeRunPhase: preserveRunProjection ? state.activeRunPhase : null,
        activeRunPhaseDetail: preserveRunProjection ? state.activeRunPhaseDetail : null,
        activeRunStartedAt: preserveRunProjection ? state.activeRunStartedAt : null,
        lastTerminalRunId: preserveRunProjection ? state.lastTerminalRunId : null,
        streaming: preserveRunProjection ? state.streaming : false,
        activeSkill: preserveRunProjection ? state.activeSkill : null,
        outline: action.outline ?? [],
        activeSessionArchived: preserveRunProjection ? state.activeSessionArchived : false,
        awaitingTranscript: false,
        transcriptOwnerSessionId: action.sessionId,
        contextUsage: contextUsageForLoadMessages(action.contextUsage, state.contextUsage),
        runTerminal: preserveRunProjection ? state.runTerminal : { kind: 'none' },
        error: null,
        runRecordsById: preserveRunProjection
          ? { ...hydratedRunRecords, ...state.runRecordsById }
          : hydratedRunRecords,
        // Walkthrough artifacts are hydrated separately via walkthrough/list
        // after load. Do NOT clear the map here: session/set (which fires
        // before load-messages) already clears it, and a walkthrough/list
        // response may resolve before load-messages is dispatched — clearing
        // here would wipe the freshly-hydrated map.
        // `live` means the session handle can accept a future prompt, not that
        // a prompt is currently running. Drop a leftover sidebar spinner unless
        // this hydration is keeping a confirmed or still-streaming run.
        workingSessionIds:
          hasConfirmedActiveRun || (preserveRunProjection && state.streaming)
            ? { ...state.workingSessionIds, [action.sessionId]: true }
            : removeWorkingSessionId(state.workingSessionIds, action.sessionId),
      };
    }
    case 'session/prepend-messages': {
      if (
        state.activeSessionId !== action.sessionId ||
        state.transcriptWindow === null ||
        state.transcriptWindow.revision !== action.transcriptPage.revision
      ) {
        return state;
      }
      const olderMessages = mapTranscriptMessagesToUi(action.messages);
      const merged = prependBoundedTranscriptPage(state.messages, olderMessages);
      return {
        ...state,
        messages: merged.messages,
        transcriptWindow: {
          revision: action.transcriptPage.revision,
          totalCount: action.transcriptPage.totalCount,
          ...(!merged.cacheLimitReached && action.transcriptPage.olderCursor
            ? { olderCursor: action.transcriptPage.olderCursor }
            : {}),
          retainedBytes: merged.retainedBytes,
          cacheLimitReached: merged.cacheLimitReached,
        },
        runRecordsById: {
          ...buildRunRecordsFromTranscriptMessages(action.messages),
          ...state.runRecordsById,
        },
      };
    }
    case 'session/seek-messages': {
      if (
        state.activeSessionId !== action.sessionId ||
        state.userMessageIndexEpoch !== action.epoch
      ) {
        return state;
      }
      const messages = mapTranscriptMessagesToUi(action.messages);
      const bounded = retainBoundedTranscriptWindow(
        messages,
        collectRetainedTranscriptMessageIds(messages, state.streaming),
      );
      const retainedMessageIds = new Set(bounded.messages.map((message) => message.id));
      return {
        ...state,
        historyView: {
          anchorMessageId: action.window.anchorMessageId,
          messages: bounded.messages,
          runRecordsById: buildRunRecordsFromTranscriptMessages(
            action.messages.filter((message) => retainedMessageIds.has(message.id)),
          ),
        },
      };
    }
    case 'session/user-message-index':
      return state.activeSessionId === action.sessionId &&
        state.userMessageIndexEpoch === action.epoch
        ? { ...state, userMessageIndex: action.index }
        : state;
    case 'session/return-to-live':
      return state.activeSessionId === action.sessionId && state.historyView !== null
        ? { ...state, historyView: null }
        : state;
    case 'session/hydrate': {
      const listable = action.sessions.filter((session) => !isPlaceholderSessionName(session.name));
      const activeProjectPath =
        state.activeScope.kind === 'project' ? state.activeScope.projectPath : null;
      return {
        ...state,
        sessions: listable,
        // Keep generalSessions in sync when general is the active scope.
        generalSessions: state.activeScope.kind === 'general' ? listable : state.generalSessions,
        // Keep the sidebar folder tree in sync for the active project.
        projectSessionsByPath:
          activeProjectPath != null
            ? { ...state.projectSessionsByPath, [activeProjectPath]: listable }
            : state.projectSessionsByPath,
        activeSessionId: listable.some((session) => session.id === state.activeSessionId)
          ? state.activeSessionId
          : null,
      };
    }
    case 'session/hydrate-scope': {
      // Drop hydrates that started before a local sidebar admit (first-send
      // name upsert). Otherwise a stale session/list replace erases the live row
      // while activeSessionId is intentionally preserved.
      if (
        action.mutationEpoch !== undefined &&
        action.mutationEpoch !== state.sessionListMutationEpoch
      ) {
        return state;
      }
      const listable = dedupeSessionsById(
        action.sessions.filter((session) => !isPlaceholderSessionName(session.name)),
      );
      const meta = {
        totalCount: action.totalCount,
        truncated: action.truncated,
      };
      const nextSessionListScopes = setSessionListScopeMeta(
        state.sessionListScopes,
        action.scope,
        meta,
      );
      if (action.scope.kind === 'general') {
        return {
          ...state,
          sessionListScopes: nextSessionListScopes,
          generalSessions: listable,
          ...(state.activeScope.kind === 'general'
            ? {
                sessions: listable,
                // Hydration must not deselect the active transcript when the
                // bounded projection does not contain that row.
                activeSessionId: state.activeSessionId,
              }
            : {}),
        };
      }
      const fillsActiveProject =
        action.fillActiveList === true ||
        (state.activeScope.kind === 'project' &&
          state.activeScope.projectPath === action.scope.projectPath);
      return {
        ...state,
        sessionListScopes: nextSessionListScopes,
        projectSessionsByPath: {
          ...state.projectSessionsByPath,
          [action.scope.projectPath]: listable,
        },
        ...(fillsActiveProject
          ? {
              sessions: listable,
              activeSessionId: state.activeSessionId,
            }
          : {}),
      };
    }
    case 'session/hydrate-project': {
      const listable = action.sessions.filter((session) => !isPlaceholderSessionName(session.name));
      return {
        ...state,
        projectSessionsByPath: {
          ...state.projectSessionsByPath,
          [action.projectPath]: listable,
        },
      };
    }
    case 'session/retain-project-paths': {
      const keep = new Set(action.projectPaths);
      if (state.projectPath) {
        keep.add(state.projectPath);
      }
      const keys = Object.keys(state.projectSessionsByPath);
      if (keys.every((projectPath) => keep.has(projectPath))) {
        return state;
      }
      return {
        ...state,
        projectSessionsByPath: retainRecordKeys(state.projectSessionsByPath, [...keep]),
      };
    }
    case 'session/hydrate-general': {
      const listable = action.sessions.filter((session) => !isPlaceholderSessionName(session.name));
      return {
        ...state,
        generalSessions: listable,
        // If general is the active scope, also mirror into sessions so the
        // active session list and activeSessionId stay in sync.
        ...(state.activeScope.kind === 'general'
          ? {
              sessions: listable,
              activeSessionId: listable.some((session) => session.id === state.activeSessionId)
                ? state.activeSessionId
                : null,
            }
          : {}),
      };
    }
    case 'session/clear-active':
      return {
        ...state,
        activeSessionId: null,
        transcriptOwnerSessionId: null,
        // New Agent is only a client-side draft until the first send creates
        // a Host session. Usage belongs to the previous active session and
        // must not leak into the uncreated draft.
        contextUsage: null,
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, {
          type: 'select',
          sessionId: null,
        }),
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        activeSkill: null,
        runTerminal: { kind: 'none' },
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    case 'session/branch-switched': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      const messages =
        action.clipAfterMessageId !== undefined
          ? (() => {
              const cut = state.messages.findIndex(
                (message) => message.id === action.clipAfterMessageId,
              );
              return cut === -1 ? state.messages : state.messages.slice(0, cut + 1);
            })()
          : action.clipBeforeMessageId !== undefined
            ? (() => {
                const cut = state.messages.findIndex(
                  (message) => message.id === action.clipBeforeMessageId,
                );
                return cut === -1 ? state.messages : state.messages.slice(0, cut);
              })()
            : mapTranscriptMessagesToUi(action.messages ?? []);
      return enforceBoundedTranscriptWindow({
        ...state,
        messages,
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        transcriptWindow: action.transcriptPage
          ? {
              revision: action.transcriptPage.revision,
              totalCount: action.transcriptPage.totalCount,
              ...(action.transcriptPage.olderCursor
                ? { olderCursor: action.transcriptPage.olderCursor }
                : {}),
              retainedBytes: measureTranscriptCacheBytes(messages),
              cacheLimitReached: false,
            }
          : null,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        error: null,
        activeSkill: null,
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
        runRecordsById:
          action.clipBeforeMessageId !== undefined || action.clipAfterMessageId !== undefined
            ? state.runRecordsById
            : buildRunRecordsFromTranscriptMessages(action.messages ?? []),
      });
    }
    default:
      return state;
  }
}

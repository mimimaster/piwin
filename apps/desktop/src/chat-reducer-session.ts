import { getSessionListScopeMeta, setSessionListScopeMeta } from './session-list-scope';
import { retainRecordKeys } from './record-budget';
import {
  measureTranscriptCacheBytes,
  prependBoundedTranscriptPage,
  retainBoundedTranscriptWindow,
} from './transcript-page-cache';
import {
  getWarmSessionSnapshot,
  removeWarmSessionSnapshot,
  stashOwnedTranscript,
} from './session-warm-cache';
import type { ChatUiAction, ChatUiState } from './chat-ui-types';
import {
  CLEARED_SUBAGENT_UI,
  dedupeSessionsById,
  removeSessionIdMarker,
  removeWorkingSessionId,
} from './chat-reducer-session-helpers';
import {
  isSessionTombstoned,
  listableSessionItems,
  upsertSessionEntities,
} from './session-entities';
import {
  buildRunRecordsFromTranscriptMessages,
  collectRetainedTranscriptMessageIds,
  enforceBoundedTranscriptWindow,
  mapTranscriptMessagesToUi,
  mergeRefreshedTailWithLiveMessages,
  preserveAssistantModelSnapshots,
  reuseUnchangedTranscriptMessages,
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
      | 'session/hydrate-error'
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
        warmSessionCache: stashOwnedTranscript(state.warmSessionCache, state),
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
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    case 'project/set': {
      const warmSessionCache = action.keepActiveSession
        ? state.warmSessionCache
        : stashOwnedTranscript(state.warmSessionCache, state);
      if (action.keepActiveSession === true) {
        return {
          ...state,
          activeScope: { kind: 'project', projectPath: action.path },
          projectPath: action.path,
          projectTrusted: action.trusted,
          trustDialogOpen: !action.trusted,
          // Keep the already-painted folder rows. Wiping this list makes the
          // sidebar swap onto an empty live source, unmount every session
          // row, then remount after hydrate — the first-click jitter.
          sessions: state.projectSessionsByPath[action.path] ?? [],
          warmSessionCache,
        };
      }
      return {
        ...state,
        activeScope: { kind: 'project', projectPath: action.path },
        projectPath: action.path,
        projectTrusted: action.trusted,
        trustDialogOpen: !action.trusted,
        warmSessionCache,
        // A project owns its own history. Do not leave another project's rows,
        // transcript, or selected session as the send target while this project's
        // index is loading. Composer snapshots park the previous owner separately.
        activeSessionId: null,
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
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        // Subagent activity is scoped to the active parent session; switching
        // scope must not surface another session's children or live streams.
        ...CLEARED_SUBAGENT_UI,
      };
    }
    case 'project/clear': {
      const warmSessionCache = action.keepActiveSession
        ? state.warmSessionCache
        : stashOwnedTranscript(state.warmSessionCache, state);
      if (action.keepActiveSession === true) {
        return {
          ...state,
          activeScope: { kind: 'general' },
          projectPath: null,
          projectTrusted: false,
          trustDialogOpen: false,
          sessions: state.generalSessions,
          warmSessionCache,
        };
      }
      return {
        ...state,
        activeScope: { kind: 'general' },
        projectPath: null,
        projectTrusted: false,
        trustDialogOpen: false,
        warmSessionCache,
        activeSessionId: null,
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
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    }
    case 'project/trust-dialog':
      return { ...state, trustDialogOpen: action.open };
    case 'project/trusted':
      return { ...state, projectTrusted: true, trustDialogOpen: false };
    case 'session/set': {
      if (
        action.ifIdle === true &&
        state.activeSessionId !== null &&
        state.activeSessionId !== action.sessionId
      ) {
        return state;
      }
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
      const preserveCompactionUi = state.activeSessionId === action.sessionId;

      // Stash the painted owner, never the destination id we have not loaded.
      let warmSessionCache = switchingAway
        ? stashOwnedTranscript(state.warmSessionCache, state)
        : state.warmSessionCache;

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
      // 2) same session → keep the already-owned rows
      // 3) cold → empty placeholder (never remount the previous session)
      // Stream events stay ignored while awaitingTranscript is true.
      const stayOnSession = state.activeSessionId === action.sessionId;
      const transcriptOwnerSessionId = preserveOptimisticDraftSend
        ? (state.transcriptOwnerSessionId ?? action.sessionId)
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
            : stayOnSession
              ? state.messages
              : [],
        transcriptWindow: warmHit
          ? warmHit.transcriptWindow
          : stayOnSession
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
        activeRunPhaseUpdatedAt: preserveOptimisticDraftSend ? state.activeRunPhaseUpdatedAt : null,
        lastTerminalRunId: null,
        streaming: preserveOptimisticDraftSend ? true : false,
        activeSkill: preserveOptimisticDraftSend ? state.activeSkill : null,
        outline: warmHit ? warmHit.outline : stayOnSession ? state.outline : [],
        activeSessionArchived: false,
        awaitingTranscript,
        transcriptOwnerSessionId,
        runTerminal: { kind: 'none' },
        compacting: preserveCompactionUi ? state.compacting : false,
        compactionActivity: preserveCompactionUi ? state.compactionActivity : null,
        lastCompactionMessage: preserveCompactionUi ? state.lastCompactionMessage : null,
        lastCompactionSummary: preserveCompactionUi ? state.lastCompactionSummary : null,
        lastCompactionTokensBefore: preserveCompactionUi
          ? state.lastCompactionTokensBefore
          : null,
        lastCompactionTokensAfter: preserveCompactionUi ? state.lastCompactionTokensAfter : null,
        lastCompactionDurationMs: preserveCompactionUi
          ? state.lastCompactionDurationMs
          : null,
        lastCompactionFileOps: preserveCompactionUi ? state.lastCompactionFileOps : null,
        // C1: clear event id ring for the new session
        receivedEventIds: new Set<string>(),
        lastAcceptedSequenceByRun: {},
        runRecordsById: warmHit
          ? warmHit.runRecordsById
          : stayOnSession
            ? state.runRecordsById
            : {},
        walkthroughsByMessageId: warmHit
          ? warmHit.walkthroughsByMessageId
          : stayOnSession
            ? state.walkthroughsByMessageId
            : {},
        contextUsage: contextUsageForSessionSet({
          warmHit,
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
        failedAttentionSessionIds: removeSessionIdMarker(
          state.failedAttentionSessionIds,
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
      // Message tail and run chrome use related but not identical gates:
      // - Merge local rows whenever a turn is live (streaming and/or activeRunId)
      //   or the caller opts in. Otherwise a stale Host page wipes the optimistic
      //   user bubble while the sidebar keeps spinning.
      // - Run chrome stays only for a Host-confirmed run id (or explicit opt-in).
      //   Bare leftover `streaming` without activeRunId must yield to hydration
      //   so a completed page can clear a stuck spinner.
      const preserveMessageTail =
        action.preserveActiveTail === true ||
        state.streaming === true ||
        state.activeRunId !== null;
      const preserveRunProjection =
        action.preserveActiveTail === true || state.activeRunId !== null;
      const hasConfirmedActiveRun = state.activeRunId !== null;
      const refreshedMessages = preserveAssistantModelSnapshots(
        mapTranscriptMessagesToUi(action.messages),
        state.messages,
      );
      const candidateMessages = reuseUnchangedTranscriptMessages(
        state.messages,
        preserveMessageTail
          ? mergeRefreshedTailWithLiveMessages(refreshedMessages, state.messages, state.streaming)
          : refreshedMessages,
      );
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
        activeRunPhaseUpdatedAt: preserveRunProjection ? state.activeRunPhaseUpdatedAt : null,
        lastTerminalRunId: preserveRunProjection
          ? state.lastTerminalRunId
          : action.pauseCheckpoint?.status === 'active'
            ? action.pauseCheckpoint.sourceRunId
            : null,
        streaming: preserveRunProjection ? state.streaming : false,
        activeSkill: preserveRunProjection ? state.activeSkill : null,
        outline: action.outline ?? [],
        activeSessionArchived: preserveRunProjection ? state.activeSessionArchived : false,
        awaitingTranscript: false,
        transcriptOwnerSessionId: action.sessionId,
        contextUsage: contextUsageForLoadMessages(action.contextUsage, state.contextUsage),
        runTerminal: preserveRunProjection
          ? state.runTerminal
          : action.pauseCheckpoint?.status === 'active'
            ? {
                kind: 'paused',
                at: Date.now(),
                checkpointId: action.pauseCheckpoint.checkpointId,
              }
            : { kind: 'none' },
        error: null,
        runRecordsById: preserveRunProjection
          ? { ...hydratedRunRecords, ...state.runRecordsById }
          : hydratedRunRecords,
        // Walkthrough artifacts are hydrated separately via walkthrough/list
        // after load. Do NOT clear the map here: session/set (which fires
        // before load-messages) already clears it, and a walkthrough/list
        // response may resolve before load-messages is dispatched — clearing
        // here would wipe the freshly-hydrated map.
        // Drop a leftover sidebar spinner unless this hydration is keeping a
        // confirmed or still-streaming run.
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
      const kept = action.sessions.filter(
        (session) => !isSessionTombstoned(state.sessionTombstonesById, session.id),
      );
      const listable = listableSessionItems(kept);
      const activeProjectPath =
        state.activeScope.kind === 'project' ? state.activeScope.projectPath : null;
      return {
        ...state,
        sessionEntitiesById: upsertSessionEntities(state.sessionEntitiesById, kept),
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
    case 'session/hydrate-error': {
      const current = getSessionListScopeMeta(state.sessionListScopes, action.scope);
      return {
        ...state,
        sessionListScopes: setSessionListScopeMeta(state.sessionListScopes, action.scope, {
          totalCount: current?.totalCount ?? 0,
          truncated: current?.truncated ?? false,
          mutationEpoch: current?.mutationEpoch ?? 0,
          queryStatus: 'error',
          queryError: action.error,
        }),
      };
    }
    case 'session/hydrate-scope': {
      const scopeEpoch =
        getSessionListScopeMeta(state.sessionListScopes, action.scope)?.mutationEpoch ?? 0;
      if (action.mutationEpoch !== undefined && action.mutationEpoch !== scopeEpoch) {
        return state;
      }
      const kept = action.sessions.filter(
        (session) => !isSessionTombstoned(state.sessionTombstonesById, session.id),
      );
      const listable = dedupeSessionsById(listableSessionItems(kept));
      const meta = {
        totalCount: action.totalCount,
        truncated: action.truncated,
        mutationEpoch: scopeEpoch,
        queryStatus: 'ready' as const,
      };
      const nextSessionListScopes = setSessionListScopeMeta(
        state.sessionListScopes,
        action.scope,
        meta,
      );
      const nextEntities = upsertSessionEntities(state.sessionEntitiesById, kept);
      if (action.scope.kind === 'general') {
        return {
          ...state,
          sessionEntitiesById: nextEntities,
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
        state.activeScope.kind === 'project' &&
        state.activeScope.projectPath === action.scope.projectPath;
      return {
        ...state,
        sessionEntitiesById: nextEntities,
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
      const kept = action.sessions.filter(
        (session) => !isSessionTombstoned(state.sessionTombstonesById, session.id),
      );
      const listable = listableSessionItems(kept);
      return {
        ...state,
        sessionEntitiesById: upsertSessionEntities(state.sessionEntitiesById, kept),
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
      const kept = action.sessions.filter(
        (session) => !isSessionTombstoned(state.sessionTombstonesById, session.id),
      );
      const listable = listableSessionItems(kept);
      return {
        ...state,
        sessionEntitiesById: upsertSessionEntities(state.sessionEntitiesById, kept),
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
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        activeSkill: null,
        runTerminal: { kind: 'none' },
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
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
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        error: null,
        activeSkill: null,
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
        runRecordsById:
          action.clipBeforeMessageId !== undefined || action.clipAfterMessageId !== undefined
            ? state.runRecordsById
            : buildRunRecordsFromTranscriptMessages(action.messages ?? []),
        contextTelemetry: applyContextTelemetry(state.contextTelemetry, {
          type: 'invalidate',
          sessionId: action.sessionId,
        }),
      });
    }
    default:
      return state;
  }
}

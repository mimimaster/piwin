import { isPlaceholderSessionName } from './title-display';
import type { SessionScope, SessionTranscriptMessage } from '@piwin/contracts';
import { adjustSessionListScopeTotal, getSessionListScopeMeta } from './session-list-scope';
import { removeWarmSessionSnapshot } from './session-warm-cache';
import type { ChatUiAction, ChatUiState, SessionListItemUi } from './chat-ui-types';
import {
  dedupeSessionsById,
  owningScopeFromLists,
  removeSessionIdMarker,
  removeWorkingSessionId,
  sessionListContainsId,
} from './chat-reducer-session-helpers';

export type ChatUiSessionListAction = Extract<
  ChatUiAction,
  {
    type:
      | 'session/add'
      | 'session/update'
      | 'session/remove'
      | 'session/mark-archived-active'
      | 'session/hide-from-list'
      | 'session/queued-turns-hydrate'
      | 'session/queued-turn-updated'
      | 'session/attention-dismiss';
  }
>;

export function reduceChatSessionList(
  state: ChatUiState,
  action: ChatUiSessionListAction,
): ChatUiState {
  switch (action.type) {
    case 'session/add': {
      // Stamp updatedAt so Conversations / project lists sort the new row to the
      // top (sort is pinned first, then updatedAt desc; missing timestamps sink).
      const createdAt = new Date().toISOString();
      const projectPath =
        state.activeScope.kind === 'project' ? state.activeScope.projectPath : null;
      const newSession: SessionListItemUi = {
        id: action.sessionId,
        name: action.name,
        updatedAt: createdAt,
        scope: projectPath != null ? { kind: 'project', projectPath } : { kind: 'general' },
      };
      // Sidebar policy: placeholder / empty names never enter the list. The
      // session can still be active (composer) until the first text title lands.
      const listable = !isPlaceholderSessionName(action.name);
      const alreadyKnown =
        projectPath != null
          ? sessionListContainsId(state.projectSessionsByPath[projectPath] ?? [], action.sessionId)
          : sessionListContainsId(state.generalSessions, action.sessionId);
      const nextSessionsForPath = listable
        ? dedupeSessionsById([
            newSession,
            ...state.sessions.filter((item) => item.id !== action.sessionId),
          ])
        : state.sessions.filter((item) => item.id !== action.sessionId);
      const nextGeneralSessions = listable
        ? dedupeSessionsById([
            newSession,
            ...state.generalSessions.filter((item) => item.id !== action.sessionId),
          ])
        : state.generalSessions.filter((item) => item.id !== action.sessionId);
      const owningScope: SessionScope =
        projectPath != null ? { kind: 'project', projectPath } : { kind: 'general' };
      const nextSessionListScopes =
        listable && !alreadyKnown
          ? adjustSessionListScopeTotal(state.sessionListScopes, owningScope, 1)
          : state.sessionListScopes;
      return {
        ...state,
        sessions: nextSessionsForPath,
        generalSessions:
          state.activeScope.kind === 'general' && listable
            ? nextGeneralSessions
            : state.generalSessions.filter((item) => item.id !== action.sessionId),
        // Mirror the new row into the folder tree for the active project.
        projectSessionsByPath:
          projectPath != null && listable
            ? { ...state.projectSessionsByPath, [projectPath]: nextSessionsForPath }
            : state.projectSessionsByPath,
        sessionListScopes: nextSessionListScopes,
        sessionListMutationEpoch:
          listable && !alreadyKnown
            ? state.sessionListMutationEpoch + 1
            : state.sessionListMutationEpoch,
        activeSessionId: action.sessionId,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        activeSkill: state.streaming ? state.activeSkill : null,
        outline: [],
        activeSessionArchived: false,
        runTerminal: { kind: 'none' },
      };
    }
    case 'session/update': {
      const sortPinnedThenUpdated = (list: SessionListItemUi[]): SessionListItemUi[] => {
        list.sort((left, right) => {
          const leftPinned = left.isPinned === true;
          const rightPinned = right.isPinned === true;
          if (leftPinned !== rightPinned) {
            return leftPinned ? -1 : 1;
          }
          // Missing updatedAt = just created; keep above stamped rows.
          const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.POSITIVE_INFINITY;
          const rightTime = right.updatedAt
            ? Date.parse(right.updatedAt)
            : Number.POSITIVE_INFINITY;
          const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
          const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
          return rightSafe - leftSafe;
        });
        return list;
      };
      // Resolve ownership from the session itself first, then from whichever
      // sidebar list already tracks it. Never invent ownership from activeScope
      // alone — that is what dual-listed project rows into Conversations.
      const existingForMerge =
        state.sessions.find((session) => session.id === action.session.id) ??
        state.generalSessions.find((session) => session.id === action.session.id) ??
        Object.values(state.projectSessionsByPath)
          .flat()
          .find((session) => session.id === action.session.id);
      const existing = existingForMerge ?? {
        id: action.session.id,
        name: '',
      };
      // Partial index pushes (e.g. created with an empty name) must not erase a
      // listable text/LLM title that already landed via name-updated.
      const patch: SessionListItemUi =
        Object.prototype.hasOwnProperty.call(action.session, 'name') &&
        isPlaceholderSessionName(action.session.name) &&
        !isPlaceholderSessionName(existing.name)
          ? (() => {
              const { name: _ignoredName, ...rest } = action.session;
              return { ...rest, name: existing.name };
            })()
          : { ...action.session };
      const mergedForCheck = {
        ...existing,
        ...patch,
      };
      const listable = !isPlaceholderSessionName(mergedForCheck.name);
      const knownInGeneral = state.generalSessions.some(
        (session) => session.id === action.session.id,
      );
      const knownProjectPath = Object.entries(state.projectSessionsByPath).find(([, list]) =>
        list.some((session) => session.id === action.session.id),
      )?.[0];
      const ownScope = action.session.scope ?? mergedForCheck.scope;
      const ownProjectPath =
        ownScope?.kind === 'project'
          ? ownScope.projectPath
          : action.session.scope?.kind === 'project'
            ? action.session.scope.projectPath
            : undefined;
      const isExplicitGeneral = ownScope?.kind === 'general';
      const isExplicitProject = ownScope?.kind === 'project' || ownProjectPath != null;
      // Project ownership wins over general so a project session cannot leak
      // into Conversations just because general is currently active.
      const owningProjectPath =
        ownProjectPath ??
        knownProjectPath ??
        (!isExplicitGeneral && !knownInGeneral && state.activeScope.kind === 'project'
          ? state.activeScope.projectPath
          : null);
      const belongsToGeneral =
        isExplicitGeneral ||
        (!isExplicitProject &&
          owningProjectPath == null &&
          (knownInGeneral || state.activeScope.kind === 'general'));

      const upsertIntoList = (
        list: SessionListItemUi[],
        shouldOwn: boolean,
      ): SessionListItemUi[] => {
        let next = list.map((session) =>
          session.id === action.session.id ? { ...session, ...patch } : session,
        );
        if (shouldOwn && listable) {
          if (!next.some((session) => session.id === action.session.id)) {
            next.unshift({
              ...patch,
              id: action.session.id,
              name: patch.name ?? mergedForCheck.name,
            });
          }
        } else if (!shouldOwn || !listable) {
          next = next.filter((session) => session.id !== action.session.id);
        }
        return sortPinnedThenUpdated(dedupeSessionsById(next));
      };

      // Active list only receives inserts for sessions that belong to the
      // current scope. Always patch/remove when the id is already present so
      // renames and archive flags stay consistent.
      const activeListOwnsSession =
        state.activeScope.kind === 'general'
          ? belongsToGeneral
          : owningProjectPath != null &&
            state.activeScope.kind === 'project' &&
            state.activeScope.projectPath === owningProjectPath;
      const nextSessions = upsertIntoList(state.sessions, activeListOwnsSession);
      const nextGeneral = upsertIntoList(state.generalSessions, belongsToGeneral);

      const owningScope: SessionScope | null =
        owningProjectPath != null
          ? { kind: 'project', projectPath: owningProjectPath }
          : belongsToGeneral
            ? { kind: 'general' }
            : null;
      const alreadyResident =
        knownInGeneral ||
        knownProjectPath !== undefined ||
        sessionListContainsId(state.sessions, action.session.id);
      const scopeMeta =
        owningScope === null ? null : getSessionListScopeMeta(state.sessionListScopes, owningScope);
      const admitWithoutCounting =
        !alreadyResident &&
        listable &&
        state.activeSessionId === action.session.id &&
        scopeMeta?.truncated === true;
      let nextSessionListScopes = state.sessionListScopes;
      if (owningScope !== null && listable && !alreadyResident && !admitWithoutCounting) {
        nextSessionListScopes = adjustSessionListScopeTotal(nextSessionListScopes, owningScope, 1);
      }
      const nextMutationEpoch =
        listable && !alreadyResident
          ? state.sessionListMutationEpoch + 1
          : state.sessionListMutationEpoch;

      if (owningProjectPath != null) {
        const owned = state.projectSessionsByPath[owningProjectPath] ?? [];
        const nextOwned = upsertIntoList(owned, true);
        // Drop the same id from any other project folders so a re-homed
        // session cannot appear under two project trees at once.
        const nextProjectSessionsByPath: Record<string, SessionListItemUi[]> = {
          ...state.projectSessionsByPath,
          [owningProjectPath]: nextOwned,
        };
        for (const [projectPath, list] of Object.entries(state.projectSessionsByPath)) {
          if (projectPath === owningProjectPath) {
            continue;
          }
          if (list.some((session) => session.id === action.session.id)) {
            nextProjectSessionsByPath[projectPath] = list.filter(
              (session) => session.id !== action.session.id,
            );
          }
        }
        return {
          ...state,
          sessions: nextSessions,
          generalSessions: nextGeneral,
          projectSessionsByPath: nextProjectSessionsByPath,
          sessionListScopes: nextSessionListScopes,
          sessionListMutationEpoch: nextMutationEpoch,
        };
      }
      return {
        ...state,
        sessions: nextSessions,
        generalSessions: nextGeneral,
        sessionListScopes: nextSessionListScopes,
        sessionListMutationEpoch: nextMutationEpoch,
      };
    }
    case 'session/remove': {
      const nextSessions = state.sessions.filter((session) => session.id !== action.sessionId);
      const nextGeneralSessions = state.generalSessions.filter(
        (session) => session.id !== action.sessionId,
      );
      const nextProjectSessionsByPath = Object.fromEntries(
        Object.entries(state.projectSessionsByPath).map(([projectPath, list]) => [
          projectPath,
          list.filter((session) => session.id !== action.sessionId),
        ]),
      );
      const removedScope = owningScopeFromLists(state, action.sessionId);
      const nextSessionListScopes =
        removedScope === null
          ? state.sessionListScopes
          : adjustSessionListScopeTotal(state.sessionListScopes, removedScope, -1);
      const activeRemoved = state.activeSessionId === action.sessionId;
      const queuedTurnsBySession = { ...state.queuedTurnsBySession };
      const queuedTurnQueueRevisions = { ...state.queuedTurnQueueRevisions };
      delete queuedTurnsBySession[action.sessionId];
      delete queuedTurnQueueRevisions[action.sessionId];
      return {
        ...state,
        sessions: nextSessions,
        generalSessions: nextGeneralSessions,
        projectSessionsByPath: nextProjectSessionsByPath,
        sessionListScopes: nextSessionListScopes,
        queuedTurnsBySession,
        queuedTurnQueueRevisions,
        warmSessionCache: removeWarmSessionSnapshot(state.warmSessionCache, action.sessionId),
        // Do not auto-select another session when the active one is removed.
        activeSessionId: activeRemoved ? null : state.activeSessionId,
        transcriptOwnerSessionId: activeRemoved ? null : state.transcriptOwnerSessionId,
        messages: activeRemoved ? [] : state.messages,
        transcriptWindow: activeRemoved ? null : state.transcriptWindow,
        historyView: activeRemoved ? null : state.historyView,
        userMessageIndex: activeRemoved ? null : state.userMessageIndex,
        userMessageIndexEpoch: activeRemoved
          ? state.userMessageIndexEpoch + 1
          : state.userMessageIndexEpoch,
        outline: activeRemoved ? [] : state.outline,
        activeSessionArchived: activeRemoved ? false : state.activeSessionArchived,
        awaitingTranscript: activeRemoved ? false : state.awaitingTranscript,
        runPhase: activeRemoved ? 'idle' : state.runPhase,
        activeRunId: activeRemoved ? null : state.activeRunId,
        activeRunPhase: activeRemoved ? null : state.activeRunPhase,
        activeRunStartedAt: activeRemoved ? null : state.activeRunStartedAt,
        streaming: activeRemoved ? false : state.streaming,
        activeSkill: activeRemoved ? null : state.activeSkill,
        runTerminal: activeRemoved ? { kind: 'none' } : state.runTerminal,
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          action.sessionId,
        ),
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
      };
    }
    case 'session/mark-archived-active':
      return {
        ...state,
        activeSessionArchived: action.archived,
      };
    case 'session/hide-from-list': {
      const nextSessions = state.sessions.filter((session) => session.id !== action.sessionId);
      const nextGeneralSessions = state.generalSessions.filter(
        (session) => session.id !== action.sessionId,
      );
      const isActive = state.activeSessionId === action.sessionId;
      return {
        ...state,
        sessions: nextSessions,
        generalSessions: nextGeneralSessions,
        // Keep activeSessionId/messages so the archived transcript remains visible.
        activeSessionArchived: isActive ? true : state.activeSessionArchived,
      };
    }
    case 'session/queued-turns-hydrate': {
      const previousRevision = state.queuedTurnQueueRevisions[action.sessionId] ?? -1;
      if (action.queueRevision < previousRevision) return state;
      return {
        ...state,
        queuedTurnsBySession: {
          ...state.queuedTurnsBySession,
          [action.sessionId]: [...action.queuedTurns].sort(
            (left, right) => left.sequence - right.sequence,
          ),
        },
        queuedTurnQueueRevisions: {
          ...state.queuedTurnQueueRevisions,
          [action.sessionId]: action.queueRevision,
        },
      };
    }
    case 'session/queued-turn-updated': {
      const queuedTurn = action.queuedTurn;
      const current = state.queuedTurnsBySession[queuedTurn.sessionId] ?? [];
      const existing = current.find((item) => item.queuedTurnId === queuedTurn.queuedTurnId);
      if (existing && existing.revision > queuedTurn.revision) return state;
      const next = existing
        ? current.map((item) => (item.queuedTurnId === queuedTurn.queuedTurnId ? queuedTurn : item))
        : [...current, queuedTurn];
      let messages = state.messages;
      if (state.activeSessionId === queuedTurn.sessionId) {
        const messageIndex = state.messages.findIndex(
          (message) => message.id === queuedTurn.userMessageId,
        );
        const previous = messageIndex >= 0 ? state.messages[messageIndex] : undefined;
        if (previous !== undefined) {
          const targetRunId = queuedTurn.startedRunId ?? queuedTurn.replaceRunId;
          const instructionDelivery: NonNullable<SessionTranscriptMessage['instructionDelivery']> =
            {
              kind: 'queued-turn',
              instructionId: queuedTurn.queuedTurnId,
              status: queuedTurn.status,
              revision: queuedTurn.revision,
              ...(targetRunId ? { targetRunId } : {}),
            };
          messages = [...state.messages];
          messages[messageIndex] = {
            ...previous,
            text: queuedTurn.input.text,
            ...(queuedTurn.startedRunId ? { runId: queuedTurn.startedRunId } : {}),
            instructionDelivery,
          };
        }
      }
      return {
        ...state,
        messages,
        queuedTurnsBySession: {
          ...state.queuedTurnsBySession,
          [queuedTurn.sessionId]: next.sort((left, right) => left.sequence - right.sequence),
        },
      };
    }
    case 'session/attention-dismiss':
      return {
        ...state,
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          action.sessionId,
        ),
      };
    default:
      return state;
  }
}

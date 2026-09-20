import { isPlaceholderSessionName } from './title-display';
import type { SessionScope, SessionTranscriptMessage } from '@piwin/contracts';
import {
  adjustSessionListScopeTotal,
  bumpSessionListScopeMutationEpoch,
  getSessionListScopeMeta,
} from './session-list-scope';
import { removeWarmSessionSnapshot } from './session-warm-cache';
import { applyContextTelemetry } from './context-telemetry-reducer';
import type { ChatUiAction, ChatUiState, SessionListItemUi } from './chat-ui-types';
import {
  addSessionTombstone,
  clearSessionTombstone,
  isSessionTombstoned,
  removeSessionEntity,
  resolveEntityScope,
  upsertSessionEntity,
} from './session-entities';
import { mergeSessionListItem } from './session-list-item-merge';
import { projectInstructionUserMessage } from './instruction-message-projection';
import { enforceBoundedTranscriptWindow } from './chat-reducer-transcript';
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

/**
 * First send from New Chat names the session via `session/add`. That is a
 * list insert + draft activation, not a session switch — keep the optimistic
 * user bubble and in-flight run chrome.
 */
function sessionAddTranscriptPatch(
  state: ChatUiState,
  sessionId: string,
): Partial<ChatUiState> {
  const activatingDraft = state.activeSessionId === null;
  const alreadyThisSession = state.activeSessionId === sessionId;
  if (alreadyThisSession || (activatingDraft && (state.streaming || state.messages.length > 0))) {
    return {
      transcriptOwnerSessionId: sessionId,
      ...(activatingDraft && state.streaming ? { foregroundAdmission: 'ready' as const } : {}),
      ...(state.streaming
        ? { workingSessionIds: { ...state.workingSessionIds, [sessionId]: true } }
        : {}),
    };
  }
  if (activatingDraft) {
    return {
      transcriptOwnerSessionId: sessionId,
      foregroundAdmission: 'ready',
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
      activeRunPhaseUpdatedAt: null,
      lastTerminalRunId: null,
      streaming: false,
      activeSkill: null,
      outline: [],
      activeSessionArchived: false,
      runTerminal: { kind: 'none' },
    };
  }
  return {};
}

export function reduceChatSessionList(
  state: ChatUiState,
  action: ChatUiSessionListAction,
): ChatUiState {
  switch (action.type) {
    case 'session/add': {
      // Stamp updatedAt so Conversations / project lists sort the new row to the
      // top (sort is pinned first, then updatedAt desc; missing timestamps sink).
      const createdAt = new Date().toISOString();
      const owningScope: SessionScope = action.scope ?? state.activeScope;
      const projectPath = owningScope.kind === 'project' ? owningScope.projectPath : null;
      const newSession: SessionListItemUi = {
        id: action.sessionId,
        name: action.name,
        updatedAt: createdAt,
        scope: owningScope,
      };
      // Sidebar policy: placeholder / empty names never enter the list. The
      // session can still be active (composer) until the first text title lands.
      const listable = !isPlaceholderSessionName(action.name);
      const alreadyKnown =
        projectPath != null
          ? sessionListContainsId(state.projectSessionsByPath[projectPath] ?? [], action.sessionId)
          : sessionListContainsId(state.generalSessions, action.sessionId);
      const belongsToActiveList =
        owningScope.kind === 'general'
          ? state.activeScope.kind === 'general'
          : state.activeScope.kind === 'project' &&
            state.activeScope.projectPath === owningScope.projectPath;
      const nextSessionsForPath = listable && belongsToActiveList
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
      const nextSessionListScopes =
        listable && !alreadyKnown
          ? bumpSessionListScopeMutationEpoch(
              adjustSessionListScopeTotal(state.sessionListScopes, owningScope, 1),
              owningScope,
            )
          : state.sessionListScopes;
      return {
        ...state,
        sessionEntitiesById: upsertSessionEntity(
          state.sessionEntitiesById,
          newSession,
        ),
        sessionTombstonesById: clearSessionTombstone(state.sessionTombstonesById, action.sessionId),
        sessions: nextSessionsForPath,
        generalSessions:
          owningScope.kind === 'general' && listable
            ? nextGeneralSessions
            : state.generalSessions.filter((item) => item.id !== action.sessionId),
        // Mirror the new row into the folder tree for the owning project.
        projectSessionsByPath:
          projectPath != null && listable
            ? {
                ...state.projectSessionsByPath,
                [projectPath]: dedupeSessionsById([
                  newSession,
                  ...(state.projectSessionsByPath[projectPath] ?? []).filter(
                    (item) => item.id !== action.sessionId,
                  ),
                ]),
              }
            : state.projectSessionsByPath,
        sessionListScopes: nextSessionListScopes,
        sessionListMutationEpoch:
          listable && !alreadyKnown
            ? state.sessionListMutationEpoch + 1
            : state.sessionListMutationEpoch,
        activeSessionId:
          state.activeSessionId === null || state.activeSessionId === action.sessionId
            ? action.sessionId
            : state.activeSessionId,
        ...sessionAddTranscriptPatch(state, action.sessionId),
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
      // Resolve ownership from the session itself, then the entity store, then
      // whichever sidebar list already tracks it. Never invent ownership from
      // activeScope — that is what dual-listed project rows into Conversations.
      // Archive uses session/remove (tombstone) so the follow-up
      // index-updated/archived push cannot re-insert the row. Unarchive must
      // explicitly revive; a regular name/pin patch must not.
      const restore = action.restore === true;
      if (isSessionTombstoned(state.sessionTombstonesById, action.session.id) && !restore) {
        return state;
      }
      const nextTombstones = restore
        ? clearSessionTombstone(state.sessionTombstonesById, action.session.id)
        : state.sessionTombstonesById;
      const existingEntity = state.sessionEntitiesById[action.session.id];
      const existingForMerge =
        existingEntity ??
        state.sessions.find((session) => session.id === action.session.id) ??
        state.generalSessions.find((session) => session.id === action.session.id) ??
        Object.values(state.projectSessionsByPath)
          .flat()
          .find((session) => session.id === action.session.id);
      const existing = existingForMerge ?? {
        id: action.session.id,
        name: '',
      };
      const patch = mergeSessionListItem(existing, action.session);
      const mergedForCheck = patch;
      const listable = !isPlaceholderSessionName(mergedForCheck.name);
      const knownInGeneral = state.generalSessions.some(
        (session) => session.id === action.session.id,
      );
      const knownProjectPath = Object.entries(state.projectSessionsByPath).find(([, list]) =>
        list.some((session) => session.id === action.session.id),
      )?.[0];
      const ownScope = patch.scope ?? resolveEntityScope(state, action.session.id);
      const ownProjectPath = ownScope?.kind === 'project' ? ownScope.projectPath : undefined;
      const isExplicitGeneral = ownScope?.kind === 'general';
      const isExplicitProject = ownScope?.kind === 'project' || ownProjectPath != null;
      const owningProjectPath = ownProjectPath ?? knownProjectPath ?? null;
      const belongsToGeneral =
        isExplicitGeneral ||
        (!isExplicitProject && owningProjectPath == null && knownInGeneral);

      const upsertIntoList = (
        list: SessionListItemUi[],
        shouldOwn: boolean,
      ): SessionListItemUi[] => {
        let next = list.map((session) =>
          // Use the merged entity. Spreading onto the old row keeps flags
          // (pin/archive) that mergeSessionListItem deleted.
          session.id === action.session.id ? patch : session,
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
      if (owningScope !== null && listable && !alreadyResident) {
        nextSessionListScopes = bumpSessionListScopeMutationEpoch(
          nextSessionListScopes,
          owningScope,
        );
      }
      const nextMutationEpoch =
        listable && !alreadyResident
          ? state.sessionListMutationEpoch + 1
          : state.sessionListMutationEpoch;
      // `patch` is already mergeSessionListItem(existing, action). Re-merging
      // it into the entity store would treat a cleared `isPinned: false` as
      // omitted and restore the previous pin.
      const nextEntities = {
        ...state.sessionEntitiesById,
        [patch.id]: patch,
      };
      if (owningScope === null) {
        return {
          ...state,
          sessionEntitiesById: nextEntities,
          sessionTombstonesById: nextTombstones,
        };
      }

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
          sessionEntitiesById: nextEntities,
          sessionTombstonesById: nextTombstones,
          sessions: nextSessions,
          generalSessions: nextGeneral,
          projectSessionsByPath: nextProjectSessionsByPath,
          sessionListScopes: nextSessionListScopes,
          sessionListMutationEpoch: nextMutationEpoch,
        };
      }
      return {
        ...state,
        sessionEntitiesById: nextEntities,
        sessionTombstonesById: nextTombstones,
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
          : bumpSessionListScopeMutationEpoch(
              adjustSessionListScopeTotal(state.sessionListScopes, removedScope, -1),
              removedScope,
            );
      const activeRemoved = state.activeSessionId === action.sessionId;
      const queuedTurnsBySession = { ...state.queuedTurnsBySession };
      const queuedTurnQueueRevisions = { ...state.queuedTurnQueueRevisions };
      delete queuedTurnsBySession[action.sessionId];
      delete queuedTurnQueueRevisions[action.sessionId];
      return {
        ...state,
        sessionEntitiesById: removeSessionEntity(state.sessionEntitiesById, action.sessionId),
        sessionTombstonesById: addSessionTombstone(state.sessionTombstonesById, action.sessionId),
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
        activeRunPhaseUpdatedAt: activeRemoved ? null : state.activeRunPhaseUpdatedAt,
        streaming: activeRemoved ? false : state.streaming,
        activeSkill: activeRemoved ? null : state.activeSkill,
        runTerminal: activeRemoved ? { kind: 'none' } : state.runTerminal,
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          action.sessionId,
        ),
        failedAttentionSessionIds: removeSessionIdMarker(
          state.failedAttentionSessionIds,
          action.sessionId,
        ),
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
        contextTelemetry: activeRemoved
          ? applyContextTelemetry(state.contextTelemetry, { type: 'select', sessionId: null })
          : state.contextTelemetry,
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
      let projectedState = state;
      if (state.activeSessionId === queuedTurn.sessionId) {
        const messageIndex = state.messages.findIndex(
          (message) => message.id === queuedTurn.userMessageId,
        );
        const previous = messageIndex >= 0 ? state.messages[messageIndex] : undefined;
        if (previous === undefined) {
          projectedState = enforceBoundedTranscriptWindow({
            ...state,
            messages: [...state.messages, projectInstructionUserMessage(queuedTurn)],
            historyView: null,
            userMessageIndex: null,
            userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
          });
          messages = projectedState.messages;
        } else if (previous.instructionDelivery?.kind !== 'run-intervention') {
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
        ...projectedState,
        messages,
        queuedTurnsBySession: {
          ...projectedState.queuedTurnsBySession,
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
        failedAttentionSessionIds: removeSessionIdMarker(
          state.failedAttentionSessionIds,
          action.sessionId,
        ),
      };
    default:
      return state;
  }
}

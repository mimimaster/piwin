import type { SessionScope } from '@piwin/contracts';
import type { ChatUiState, SessionListItemUi } from './chat-ui-types';
import { mergeSessionListItem } from './session-list-item-merge';
import { isPlaceholderSessionName } from './title-display';

export function upsertSessionEntities(
  entities: Record<string, SessionListItemUi>,
  sessions: readonly SessionListItemUi[],
): Record<string, SessionListItemUi> {
  if (sessions.length === 0) {
    return entities;
  }
  const next = { ...entities };
  for (const session of sessions) {
    next[session.id] = mergeSessionListItem(next[session.id], session);
  }
  return next;
}

export function upsertSessionEntity(
  entities: Record<string, SessionListItemUi>,
  session: SessionListItemUi,
): Record<string, SessionListItemUi> {
  return upsertSessionEntities(entities, [session]);
}

export function removeSessionEntity(
  entities: Record<string, SessionListItemUi>,
  sessionId: string,
): Record<string, SessionListItemUi> {
  if (!(sessionId in entities)) {
    return entities;
  }
  const next = { ...entities };
  delete next[sessionId];
  return next;
}

export function addSessionTombstone(
  tombstones: Record<string, true>,
  sessionId: string,
): Record<string, true> {
  if (sessionId in tombstones) {
    return tombstones;
  }
  return { ...tombstones, [sessionId]: true };
}

export function clearSessionTombstone(
  tombstones: Record<string, true>,
  sessionId: string,
): Record<string, true> {
  if (!(sessionId in tombstones)) {
    return tombstones;
  }
  const next = { ...tombstones };
  delete next[sessionId];
  return next;
}

export function isSessionTombstoned(
  tombstones: Record<string, true>,
  sessionId: string,
): boolean {
  return sessionId in tombstones;
}

export function listableSessionItems(
  sessions: readonly SessionListItemUi[],
): SessionListItemUi[] {
  return sessions.filter((session) => !isPlaceholderSessionName(session.name));
}

export function resolveEntityScope(
  state: Pick<ChatUiState, 'sessionEntitiesById' | 'generalSessions' | 'projectSessionsByPath'>,
  sessionId: string,
): SessionScope | null {
  const entity = state.sessionEntitiesById[sessionId];
  if (entity?.scope) {
    return entity.scope;
  }
  if (state.generalSessions.some((session) => session.id === sessionId)) {
    return { kind: 'general' };
  }
  for (const [projectPath, list] of Object.entries(state.projectSessionsByPath)) {
    if (list.some((session) => session.id === sessionId)) {
      return { kind: 'project', projectPath };
    }
  }
  return null;
}

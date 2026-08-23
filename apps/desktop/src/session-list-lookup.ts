import type { SessionListItemUi } from './chat-reducer';

export type SessionLookupLists = {
  sessions?: readonly SessionListItemUi[];
  generalSessions?: readonly SessionListItemUi[];
  projectSessionsByPath?: Record<string, readonly SessionListItemUi[]>;
};

/** Merge two session lists, deduplicating by id (first occurrence wins). */
export function mergeSessionsForLookup(
  primary: readonly SessionListItemUi[],
  secondary: readonly SessionListItemUi[],
): SessionListItemUi[] {
  return collectSessionsForLookup({ sessions: primary, generalSessions: secondary });
}

/** Flatten every resident sidebar list so menu actions can resolve a row by id. */
export function collectSessionsForLookup(lists: SessionLookupLists): SessionListItemUi[] {
  const collected: SessionListItemUi[] = [];
  const seen = new Set<string>();
  const add = (items: readonly SessionListItemUi[] | undefined): void => {
    if (items === undefined) {
      return;
    }
    for (const session of items) {
      if (seen.has(session.id)) {
        continue;
      }
      seen.add(session.id);
      collected.push(session);
    }
  };
  add(lists.sessions);
  add(lists.generalSessions);
  if (lists.projectSessionsByPath) {
    for (const projectSessions of Object.values(lists.projectSessionsByPath)) {
      add(projectSessions);
    }
  }
  return collected;
}

export function findSessionForLookup(
  sessionId: string,
  lists: SessionLookupLists,
): SessionListItemUi | undefined {
  return collectSessionsForLookup(lists).find((session) => session.id === sessionId);
}

import type { SessionListItemUi } from './chat-reducer';

/** Merge two session lists, deduplicating by id (first occurrence wins). */
export function mergeSessionsForLookup(
  primary: SessionListItemUi[],
  secondary: SessionListItemUi[],
): SessionListItemUi[] {
  const seen = new Set(primary.map((session) => session.id));
  return [...primary, ...secondary.filter((session) => !seen.has(session.id))];
}

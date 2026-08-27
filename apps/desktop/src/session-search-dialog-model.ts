import type { SessionScope } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';

export type SessionSearchDialogItem = SessionListItemUi & {
  scope: SessionScope;
};

export type BuildSessionSearchDialogItemsInput = {
  primaryScope: SessionScope;
  primarySessions: readonly SessionListItemUi[];
  generalSessions: readonly SessionListItemUi[];
  query: string;
  limit?: number;
};

/**
 * Merge the active-scope and General projections without losing Host relevance
 * order. Empty-query results become a true recent list; active search results
 * retain the order returned by `session/search`.
 */
export function buildSessionSearchDialogItems(
  input: BuildSessionSearchDialogItemsInput,
): SessionSearchDialogItem[] {
  const merged: SessionSearchDialogItem[] = [];
  const seenSessionIds = new Set<string>();

  const append = (session: SessionListItemUi, fallbackScope: SessionScope): void => {
    if (seenSessionIds.has(session.id) || session.name.trim().length === 0) {
      return;
    }
    seenSessionIds.add(session.id);
    merged.push({ ...session, scope: session.scope ?? fallbackScope });
  };

  for (const session of input.primarySessions) {
    append(session, input.primaryScope);
  }
  for (const session of input.generalSessions) {
    append(session, { kind: 'general' });
  }

  const ordered = input.query.trim()
    ? merged
    : merged
        .map((session, originalIndex) => ({ session, originalIndex }))
        .sort((left, right) => {
          const leftTimestamp = Date.parse(left.session.updatedAt ?? '');
          const rightTimestamp = Date.parse(right.session.updatedAt ?? '');
          const normalizedLeft = Number.isFinite(leftTimestamp) ? leftTimestamp : 0;
          const normalizedRight = Number.isFinite(rightTimestamp) ? rightTimestamp : 0;
          return normalizedRight - normalizedLeft || left.originalIndex - right.originalIndex;
        })
        .map(({ session }) => session);

  const limit = Math.max(1, input.limit ?? 30);
  return ordered.slice(0, limit);
}

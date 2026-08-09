import type { SessionScope } from '@piwin/contracts';

/** A local-only composer draft that has not become a Host session yet. */
export type DraftSessionItemUi = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  scope: SessionScope;
  isDraft: true;
};

export function sortDraftSessions(list: readonly DraftSessionItemUi[]): DraftSessionItemUi[] {
  return [...list].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
    const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
    return rightSafe - leftSafe;
  });
}

export function draftSessionMatchesQuery(draft: DraftSessionItemUi, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return `${draft.name} ${draft.text}`.toLowerCase().includes(normalizedQuery);
}

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

export function sameDraftScope(left: SessionScope, right: SessionScope): boolean {
  if (left.kind === 'general' || right.kind === 'general') {
    return left.kind === 'general' && right.kind === 'general';
  }
  return left.projectPath === right.projectPath;
}

export function findLatestDraftForScope(
  drafts: readonly DraftSessionItemUi[],
  scope: SessionScope,
): DraftSessionItemUi | undefined {
  const matching = drafts.filter((draft) => sameDraftScope(draft.scope, scope));
  if (matching.length === 0) {
    return undefined;
  }
  return [...matching].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt) || Date.parse(left.createdAt);
    const rightTime = Date.parse(right.updatedAt) || Date.parse(right.createdAt);
    const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
    const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
    if (rightSafe !== leftSafe) {
      return rightSafe - leftSafe;
    }
    return right.id.localeCompare(left.id);
  })[0];
}

export function draftSessionMatchesQuery(draft: DraftSessionItemUi, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return `${draft.name} ${draft.text}`.toLowerCase().includes(normalizedQuery);
}

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

/**
 * Sidebar draft rows show one ellipsized line. Deriving the label from the
 * whole draft put a pasted transcript's full body into the row's DOM, so every
 * keystroke re-laid-out (and re-shaped) hundreds of KB of text in the sidebar.
 */
export const DRAFT_ROW_LABEL_MAX_CHARS = 200;

/** Single-line sidebar label for a draft: whitespace collapsed, length bounded. */
export function draftRowLabel(text: string): string {
  // Collapsing whitespace only shrinks the prefix, so twice the cap is enough
  // input for any label that is not mostly runs of blank space.
  const head = text.trimStart().slice(0, DRAFT_ROW_LABEL_MAX_CHARS * 2);
  return head.replace(/\s+/g, ' ').trim().slice(0, DRAFT_ROW_LABEL_MAX_CHARS);
}

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

/**
 * "Locate open session" (IDE "select opened file"): which folds must open so
 * the open session's row is painted in the sidebar tree.
 *
 * An explicit user fold always wins over the passive reveal fallback (see
 * `resolveSidebarProjectCollapsed`), so a folded ancestor hides the open
 * session for good. Locate is the explicit gesture that undoes exactly those
 * folds — the ancestors of the target row — and nothing else.
 */
import { filterSidebarRowsByMode, type SidebarMode } from './sidebar-mode';
import { sidebarFolderCollapseKey } from './sidebar-fold-latch';
import {
  buildSidebarTreeRows,
  sidebarTreeRowDepth,
  type SidebarTreeRow,
  type SidebarTreeRowsInput,
} from './sidebar-tree-rows';

export type SidebarRevealPlan = {
  /** Session or draft id whose row is revealed. */
  targetId: string;
  /** Sidebar pane that lists the target row. */
  mode: SidebarMode;
  section: 'pinned' | 'projects' | 'conversations';
  /** `collapsedProjects` keys of the folders enclosing the target row. */
  unfoldKeys: string[];
  /** The target sits inside the "unavailable workspaces" group. */
  unfoldUnavailable: boolean;
};

function isTargetRow(row: SidebarTreeRow, targetId: string): boolean {
  return row.kind === 'session' && row.session.id === targetId;
}

/** The tree with every fold open, so a row's ancestors show whatever the user folded. */
function buildUnfoldedRows(input: SidebarTreeRowsInput): SidebarTreeRow[] {
  return buildSidebarTreeRows({
    ...input,
    pinnedSectionExpanded: true,
    projectsSectionExpanded: true,
    conversationsSectionExpanded: true,
    collapsedProjects: {},
    unavailableGroupCollapsed: false,
  });
}

type EnclosingFolds = Pick<SidebarRevealPlan, 'unfoldKeys' | 'unfoldUnavailable'> & {
  section: SidebarRevealPlan['section'] | null;
};

/** Walks up from `targetIndex` collecting the folds that enclose that row. */
function collectEnclosingFolds(
  rows: readonly SidebarTreeRow[],
  targetIndex: number,
  input: SidebarTreeRowsInput,
): EnclosingFolds {
  const target = rows[targetIndex];
  let depth = target === undefined ? 0 : sidebarTreeRowDepth(target);
  let section: EnclosingFolds['section'] = null;
  const unfoldKeys: string[] = [];
  let unfoldUnavailable = false;
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row === undefined) {
      continue;
    }
    if (row.kind === 'section-header') {
      section = row.sectionId;
      break;
    }
    if (depth === 0) {
      continue;
    }
    if (
      row.kind !== 'project-folder' &&
      row.kind !== 'no-repo-folder' &&
      row.kind !== 'unavailable-group'
    ) {
      continue;
    }
    if (row.depth >= depth) {
      continue;
    }
    depth = row.depth;
    if (row.kind === 'unavailable-group') {
      unfoldUnavailable = true;
    } else {
      unfoldKeys.push(sidebarFolderCollapseKey(row, input));
    }
  }
  return { section, unfoldKeys, unfoldUnavailable };
}

/**
 * Returns null when the target is listed nowhere in the tree (archived and
 * hidden, filtered out by search, or not a sidebar session at all).
 */
export function planSidebarReveal(input: SidebarTreeRowsInput): SidebarRevealPlan | null {
  const targetId = input.revealSessionId ?? input.revealDraftId ?? null;
  if (!targetId) {
    return null;
  }
  const rows = buildUnfoldedRows(input);
  const targetIndex = rows.findIndex((row) => isTargetRow(row, targetId));
  if (targetIndex < 0) {
    return null;
  }
  const { section, unfoldKeys, unfoldUnavailable } = collectEnclosingFolds(
    rows,
    targetIndex,
    input,
  );
  if (section === null) {
    return null;
  }
  const mode: SidebarMode = filterSidebarRowsByMode(rows, 'code').some((row) =>
    isTargetRow(row, targetId),
  )
    ? 'code'
    : 'chat';
  return { targetId, mode, section, unfoldKeys, unfoldUnavailable };
}

/**
 * `collapsedProjects` keys of the folders that contain the active project's
 * own folder (a project remembered inside another remembered path is listed
 * under it). The active folder itself is excluded: folding it is the user's
 * call, but a fold on an ancestor would hide the active project entirely.
 * Null while the active project has no folder in the tree yet (just opened,
 * project list not refreshed).
 */
export function activeProjectEnclosingFoldKeys(input: SidebarTreeRowsInput): string[] | null {
  const activePath = input.activeProjectPath;
  if (!activePath) {
    return null;
  }
  const rows = buildUnfoldedRows(input);
  const targetIndex = rows.findIndex(
    (row) =>
      row.kind === 'project-folder' &&
      (row.projectPath === activePath || (row.aliasPaths ?? []).includes(activePath)),
  );
  if (targetIndex < 0) {
    return null;
  }
  return collectEnclosingFolds(rows, targetIndex, input).unfoldKeys;
}

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
import {
  buildSidebarTreeRows,
  NO_REPO_SIDEBAR_KEY,
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

function folderCollapseKey(
  row: Extract<SidebarTreeRow, { kind: 'project-folder' | 'no-repo-folder' }>,
  input: SidebarTreeRowsInput,
): string {
  if (row.kind === 'no-repo-folder') {
    return input.noRepoProjectPath?.trim() || NO_REPO_SIDEBAR_KEY;
  }
  return row.repository?.collapseKey ?? row.projectPath;
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
  // Every fold open: the target's position in the fully unfolded tree tells
  // which folders enclose it, whatever the user folded meanwhile.
  const rows = buildSidebarTreeRows({
    ...input,
    pinnedSectionExpanded: true,
    projectsSectionExpanded: true,
    conversationsSectionExpanded: true,
    collapsedProjects: {},
    unavailableGroupCollapsed: false,
  });
  const targetIndex = rows.findIndex((row) => isTargetRow(row, targetId));
  const target = rows[targetIndex];
  if (target === undefined) {
    return null;
  }

  let depth = sidebarTreeRowDepth(target);
  let section: SidebarRevealPlan['section'] | null = null;
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
      unfoldKeys.push(folderCollapseKey(row, input));
    }
  }
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

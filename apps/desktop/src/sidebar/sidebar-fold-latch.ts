/**
 * Sticky folder folds: a folder the tree opened on its own (it held the active
 * project or the open session) stays open after navigation moves elsewhere.
 *
 * `resolveSidebarProjectCollapsed` opens untouched folders only while they
 * hold the active project/session, so without a latch clicking a session in
 * another project would fold the folder the user was just reading. Recording
 * those auto-opened folders as explicitly open turns "open because active"
 * into "open until the user folds it".
 */
import {
  NO_REPO_SIDEBAR_KEY,
  type SidebarTreeRow,
  type SidebarTreeRowsInput,
} from './sidebar-tree-rows';

/** The `collapsedProjects` key a folder row reads and its chevron writes. */
export function sidebarFolderCollapseKey(
  row: Extract<SidebarTreeRow, { kind: 'project-folder' | 'no-repo-folder' }>,
  input: Pick<SidebarTreeRowsInput, 'noRepoProjectPath'>,
): string {
  if (row.kind === 'no-repo-folder') {
    return input.noRepoProjectPath?.trim() || NO_REPO_SIDEBAR_KEY;
  }
  return row.repository?.collapseKey ?? row.projectPath;
}

/**
 * Keys of folders painted open without an explicit user fold/unfold. Empty
 * while searching: search opens every folder, which is not the user's intent.
 */
export function autoOpenedFolderKeys(
  rows: readonly SidebarTreeRow[],
  input: Pick<SidebarTreeRowsInput, 'collapsedProjects' | 'noRepoProjectPath' | 'sessionSearch'>,
): string[] {
  if (input.sessionSearch.trim().length > 0) {
    return [];
  }
  const keys: string[] = [];
  for (const row of rows) {
    if ((row.kind !== 'project-folder' && row.kind !== 'no-repo-folder') || row.collapsed) {
      continue;
    }
    const key = sidebarFolderCollapseKey(row, input);
    if (!Object.prototype.hasOwnProperty.call(input.collapsedProjects, key)) {
      keys.push(key);
    }
  }
  return keys;
}

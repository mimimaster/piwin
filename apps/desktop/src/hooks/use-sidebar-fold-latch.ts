/**
 * Records folders the tree opened on its own as explicitly open, so moving to
 * another project's session never folds the folder the user just left. See
 * `sidebar-fold-latch.ts` for the policy.
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { autoOpenedFolderKeys } from '../sidebar/sidebar-fold-latch';
import type { SidebarTreeRow, SidebarTreeRowsInput } from '../sidebar/sidebar-tree-rows';

export function useSidebarFoldLatch(
  rows: readonly SidebarTreeRow[],
  treeInput: SidebarTreeRowsInput,
  setCollapsedProjects: Dispatch<SetStateAction<Record<string, boolean>>>,
): void {
  useEffect(() => {
    const keys = autoOpenedFolderKeys(rows, treeInput);
    if (keys.length === 0) {
      return;
    }
    setCollapsedProjects((previous) => {
      // Re-check against the latest state: a user fold queued since this
      // render must win over the latch.
      const missing = keys.filter(
        (key) => !Object.prototype.hasOwnProperty.call(previous, key),
      );
      if (missing.length === 0) {
        return previous;
      }
      const next = { ...previous };
      for (const key of missing) {
        next[key] = false;
      }
      return next;
    });
  }, [rows, treeInput, setCollapsedProjects]);
}

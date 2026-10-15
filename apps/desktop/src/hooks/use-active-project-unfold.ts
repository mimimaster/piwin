/**
 * Opening a project is navigation: when the active project changes, drop any
 * explicit fold on a folder that contains it. A project remembered inside
 * another remembered path (`/ios/ctf`) is listed under that folder, so a fold
 * left on `/ios` would otherwise hide the project the user just opened.
 *
 * Runs once per navigation. A fold the user makes afterwards stays put, even
 * across project-list refreshes.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { activeProjectEnclosingFoldKeys } from '../sidebar-reveal-plan';
import type { SidebarTreeRowsInput } from '../sidebar-tree-rows';

export function useActiveProjectUnfold(
  treeInput: SidebarTreeRowsInput,
  setCollapsedProjects: Dispatch<SetStateAction<Record<string, boolean>>>,
): void {
  const activeProjectPath = treeInput.activeProjectPath ?? null;
  const recentProjects = treeInput.recentProjects;
  const inputRef = useRef(treeInput);
  inputRef.current = treeInput;
  /** Active path still waiting for its folder to appear in the tree. */
  const pendingPathRef = useRef<string | null>(null);

  useEffect(() => {
    pendingPathRef.current = activeProjectPath;
  }, [activeProjectPath]);

  useEffect(() => {
    const pendingPath = pendingPathRef.current;
    if (pendingPath === null || pendingPath !== activeProjectPath) {
      return;
    }
    const keys = activeProjectEnclosingFoldKeys(inputRef.current);
    if (keys === null) {
      // A just-opened project lands in the list a moment later; retry then.
      return;
    }
    pendingPathRef.current = null;
    if (keys.length === 0) {
      return;
    }
    setCollapsedProjects((previous) => {
      if (!keys.some((key) => previous[key] === true)) {
        return previous;
      }
      // Remove rather than set false: the folder falls back to the default
      // policy, which opens it (it holds the active project) and the fold
      // latch then keeps it open.
      const next = { ...previous };
      for (const key of keys) {
        if (next[key] === true) {
          delete next[key];
        }
      }
      return next;
    });
  }, [activeProjectPath, recentProjects, setCollapsedProjects]);
}

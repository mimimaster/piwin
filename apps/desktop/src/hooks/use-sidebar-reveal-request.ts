/**
 * Applies a "locate open session" request to the sidebar's local fold state,
 * then scrolls to and focuses the session row once the tree repaints with it.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { SidebarMode } from '../sidebar-mode';
import { planSidebarReveal } from '../sidebar-reveal-plan';
import type { SidebarTreeRow, SidebarTreeRowsInput } from '../sidebar-tree-rows';

export type SidebarRevealRequestOptions = {
  /** Bumped by the titlebar locate button; 0/undefined means no request yet. */
  request: number | undefined;
  treeInput: SidebarTreeRowsInput;
  treeRows: readonly SidebarTreeRow[];
  sidebarMode: SidebarMode;
  selectSidebarMode: (mode: SidebarMode) => void;
  setPinnedSectionExpanded: Dispatch<SetStateAction<boolean>>;
  setProjectsSectionExpanded: Dispatch<SetStateAction<boolean>>;
  setConversationsSectionExpanded: Dispatch<SetStateAction<boolean>>;
  setCollapsedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  setUnavailableGroupCollapsed: Dispatch<SetStateAction<boolean>>;
  focusSessionRow: (rowIndex: number) => void;
};

export function useSidebarRevealRequest(options: SidebarRevealRequestOptions): void {
  const { request, treeRows, focusSessionRow } = options;
  // Latest options without re-running the request effect on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [pendingTarget, setPendingTarget] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (!request) {
      return;
    }
    const current = optionsRef.current;
    const plan = planSidebarReveal(current.treeInput);
    if (plan === null) {
      return;
    }
    if (plan.mode !== current.sidebarMode) {
      current.selectSidebarMode(plan.mode);
    }
    if (plan.section === 'pinned') current.setPinnedSectionExpanded(true);
    if (plan.section === 'projects') current.setProjectsSectionExpanded(true);
    if (plan.section === 'conversations') current.setConversationsSectionExpanded(true);
    if (plan.unfoldUnavailable) current.setUnavailableGroupCollapsed(false);
    if (plan.unfoldKeys.length > 0) {
      current.setCollapsedProjects((previous) => {
        const next = { ...previous };
        for (const key of plan.unfoldKeys) {
          next[key] = false;
        }
        return next;
      });
    }
    // Fresh object so an unchanged tree still re-runs the focus effect.
    setPendingTarget({ id: plan.targetId });
  }, [request]);

  useEffect(() => {
    if (pendingTarget === null) {
      return;
    }
    const rowIndex = treeRows.findIndex(
      (row) => row.kind === 'session' && row.session.id === pendingTarget.id,
    );
    if (rowIndex < 0) {
      return;
    }
    setPendingTarget(null);
    focusSessionRow(rowIndex);
  }, [focusSessionRow, pendingTarget, treeRows]);
}

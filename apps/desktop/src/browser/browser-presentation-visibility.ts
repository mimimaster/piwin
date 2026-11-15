import { selectVisibleWorkspaceViews } from '../workbench/docking/visible-views.js';
import type { WorkspaceState } from '../workbench/docking/types.js';
import { resolveBrowserMiniVisibility, type BrowserMiniActivity } from './browser-mini-policy.js';

export function hasVisibleBrowserPresentation(input: {
  covered: boolean;
  phone: boolean;
  rightPanelOpen: boolean;
  rightPanelBrowser: boolean;
  /** Actual docked body visibility, distinct from an expanded inspector. */
  rightDockedBodyVisible?: boolean;
  dockingState: WorkspaceState | null;
  miniDismissed: boolean;
  activity: BrowserMiniActivity;
}): boolean {
  if (input.covered) return false;
  const fullVisible = input.dockingState === null
    ? input.rightPanelOpen && input.rightPanelBrowser
    : selectVisibleWorkspaceViews(input.dockingState, {
      phone: input.phone,
      rightPanelOpen: input.rightPanelOpen && (input.rightDockedBodyVisible ?? input.rightPanelBrowser),
    }).some((view) => view.kind === 'browser');
  if (fullVisible) return true;
  return resolveBrowserMiniVisibility({
    rightBodyOpen: input.rightPanelOpen, overlayOpen: input.covered, phone: input.phone,
    dismissed: input.miniDismissed, activity: input.activity,
  }).visible;
}

import { selectVisibleWorkspaceViews } from '../workbench/docking/visible-views.js';
import type { WorkspaceState } from '../workbench/docking/types.js';
import { resolveBrowserMiniVisibility, type BrowserMiniActivity } from './browser-mini-policy.js';

export type FullBrowserVisibilityInput = {
  phone: boolean;
  rightPanelOpen: boolean;
  rightPanelBrowser: boolean;
  /** Actual docked body visibility, distinct from an expanded inspector. */
  rightDockedBodyVisible?: boolean | undefined;
  dockingState: WorkspaceState | null;
};

export function isFullBrowserSurfaceVisible(input: FullBrowserVisibilityInput): boolean {
  return input.dockingState === null
    ? input.rightPanelOpen && input.rightPanelBrowser
    : selectVisibleWorkspaceViews(input.dockingState, {
      phone: input.phone,
      rightPanelOpen: input.rightPanelOpen && (input.rightDockedBodyVisible ?? input.rightPanelBrowser),
    }).some((view) => view.kind === 'browser');
}

export function hasVisibleBrowserPresentation(input: FullBrowserVisibilityInput & {
  covered: boolean;
  miniDismissed: boolean;
  activity: BrowserMiniActivity;
}): boolean {
  if (input.covered) return false;
  if (isFullBrowserSurfaceVisible(input)) return true;
  return resolveBrowserMiniVisibility({
    rightBodyOpen: input.rightPanelOpen, overlayOpen: input.covered, phone: input.phone,
    dismissed: input.miniDismissed, activity: input.activity,
  }).visible;
}

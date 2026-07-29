/**
 * Right-panel window helpers (product model 2026-07-29).
 *
 * Desktop panel open is **in-flow reflow**: a third grid column takes space from
 * the stage so the chat column narrows/widens. We do **not** grow/shrink the
 * OS window — setSize caused whole-shell font re-rasterization ("visual
 * refresh") and fought the grid for two frames of jitter.
 *
 * These functions remain as no-ops so older call sites compile; do not re-add
 * Tauri setSize without product sign-off.
 */

import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';

/** @deprecated Prefer CSS `--right-panel-width`; kept for call-site defaults. */
export const RIGHT_PANEL_OUTWARD_WIDTH_PX = RIGHT_PANEL_DEFAULT_WIDTH_PX;

/** Always 0 — OS window is never grown for the panel. */
let expandedDeltaPx = 0;

export function isRightPanelWindowAdjustInFlight(): boolean {
  return false;
}

export async function expandWindowOutwardForRightPanel(
  _widthPx: number = RIGHT_PANEL_DEFAULT_WIDTH_PX,
): Promise<void> {
  void _widthPx;
  expandedDeltaPx = 0;
}

export async function shrinkWindowInwardAfterRightPanel(): Promise<void> {
  expandedDeltaPx = 0;
}

export async function adjustWindowOutwardForRightPanelWidth(
  _nextWidthPx: number,
): Promise<void> {
  void _nextWidthPx;
}

export function getRightPanelWindowExpandDelta(): number {
  return expandedDeltaPx;
}

export function resetRightPanelWindowExpandState(): void {
  expandedDeltaPx = 0;
}

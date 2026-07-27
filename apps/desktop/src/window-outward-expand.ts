/**
 * True outward expand: grow the native window to the right when the workspace
 * panel opens, so the stage column keeps the same pixel width.
 * Without Tauri (browser mock), this is a no-op and CSS must not shrink stage.
 *
 * Tracks the actual expanded delta so open/close/resize stay paired even when
 * the user drags the panel wider or narrower after open.
 */

import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';

/** @deprecated Prefer passing an explicit width; kept for call-site defaults. */
export const RIGHT_PANEL_OUTWARD_WIDTH_PX = RIGHT_PANEL_DEFAULT_WIDTH_PX;

/** Logical CSS pixels currently added to the OS window for the right panel. */
let expandedDeltaPx = 0;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function adjustWindowWidthBy(deltaLogicalPx: number): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  if (deltaLogicalPx === 0) {
    return;
  }
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { LogicalSize } = await import('@tauri-apps/api/dpi');
    const currentWindow = getCurrentWindow();
    const physicalSize = await currentWindow.innerSize();
    const scaleFactor = await currentWindow.scaleFactor();
    const logicalWidth = physicalSize.width / scaleFactor;
    const logicalHeight = physicalSize.height / scaleFactor;
    const nextWidth =
      deltaLogicalPx > 0
        ? logicalWidth + deltaLogicalPx
        : Math.max(800, logicalWidth + deltaLogicalPx);
    await currentWindow.setSize(new LogicalSize(nextWidth, logicalHeight));
  } catch (error) {
    console.warn('[piwin] window width adjust failed', error);
  }
}

/**
 * Grow the current window's inner width by `widthPx` for the right panel.
 * Safe to call repeatedly only once per open cycle (caller must pair with shrink).
 */
export async function expandWindowOutwardForRightPanel(
  widthPx: number = RIGHT_PANEL_DEFAULT_WIDTH_PX,
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  if (expandedDeltaPx > 0) {
    return;
  }
  const delta = Math.max(0, Math.round(widthPx));
  if (delta === 0) {
    return;
  }
  await adjustWindowWidthBy(delta);
  expandedDeltaPx = delta;
}

/** Shrink the current window by the delta previously expanded for the panel. */
export async function shrinkWindowInwardAfterRightPanel(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  if (expandedDeltaPx <= 0) {
    return;
  }
  const delta = expandedDeltaPx;
  await adjustWindowWidthBy(-delta);
  expandedDeltaPx = 0;
}

/**
 * While the panel is open, grow/shrink the OS window by the difference between
 * the new panel width and the width we already expanded for. Keeps stage pixels
 * stable during drag resize on desktop (Tauri).
 */
export async function adjustWindowOutwardForRightPanelWidth(
  nextWidthPx: number,
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  if (expandedDeltaPx <= 0) {
    // Panel not currently expanded via window grow — ignore.
    return;
  }
  const next = Math.max(0, Math.round(nextWidthPx));
  const delta = next - expandedDeltaPx;
  if (delta === 0) {
    return;
  }
  await adjustWindowWidthBy(delta);
  expandedDeltaPx = next;
}

/** Test/helper: how many logical px the window currently claims for the panel. */
export function getRightPanelWindowExpandDelta(): number {
  return expandedDeltaPx;
}

/** Test helper: reset expand bookkeeping without touching the OS window. */
export function resetRightPanelWindowExpandState(): void {
  expandedDeltaPx = 0;
}

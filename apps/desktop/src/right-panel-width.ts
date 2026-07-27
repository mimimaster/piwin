/**
 * Right workspace panel width: pure clamp + localStorage persistence.
 * CSS consumes the value via --right-panel-width on .app-shell.
 */

export const RIGHT_PANEL_DEFAULT_WIDTH_PX = 320;
export const RIGHT_PANEL_MIN_WIDTH_PX = 240;
export const RIGHT_PANEL_MAX_WIDTH_PX = 640;

const STORAGE_KEY = 'piwin.desktop.rightPanelWidth';

export function clampRightPanelWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) {
    return RIGHT_PANEL_DEFAULT_WIDTH_PX;
  }
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH_PX,
    Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.round(widthPx)),
  );
}

/**
 * Clamp against both absolute limits and remaining stage budget so the chat
 * column cannot collapse below `minStagePx` while the panel is open.
 */
export function clampRightPanelWidthForViewport(
  widthPx: number,
  viewportWidth: number,
  options?: { minStagePx?: number; reservedChromePx?: number },
): number {
  const minStagePx = options?.minStagePx ?? 360;
  const reservedChromePx = options?.reservedChromePx ?? 0;
  const maxFromViewport = Math.max(
    RIGHT_PANEL_MIN_WIDTH_PX,
    viewportWidth - reservedChromePx - minStagePx,
  );
  const absolute = clampRightPanelWidth(widthPx);
  return Math.min(absolute, maxFromViewport);
}

export function loadRightPanelWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) {
      return RIGHT_PANEL_DEFAULT_WIDTH_PX;
    }
    return clampRightPanelWidth(Number(raw));
  } catch {
    return RIGHT_PANEL_DEFAULT_WIDTH_PX;
  }
}

export function saveRightPanelWidth(widthPx: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampRightPanelWidth(widthPx)));
  } catch {
    // private mode / SSR — ignore
  }
}

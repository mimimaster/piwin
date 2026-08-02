/**
 * Left navigator width: pure clamp + localStorage persistence.
 * CSS consumes the value via --sidebar-width on .app-shell.
 */

export const SIDEBAR_DEFAULT_WIDTH_PX = 240;
export const SIDEBAR_MIN_WIDTH_PX = 200;
export const SIDEBAR_MAX_WIDTH_PX = 420;

const STORAGE_KEY = 'piwin.desktop.sidebarWidth';

export function clampSidebarWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) {
    return SIDEBAR_DEFAULT_WIDTH_PX;
  }
  return Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, Math.round(widthPx)));
}

/**
 * Keep enough stage room when both navigator and right panel are open.
 */
export function clampSidebarWidthForViewport(
  widthPx: number,
  viewportWidth: number,
  options?: { minStagePx?: number; reservedChromePx?: number },
): number {
  const minStagePx = options?.minStagePx ?? 280;
  const reservedChromePx = options?.reservedChromePx ?? 0;
  const maxFromViewport = Math.max(
    SIDEBAR_MIN_WIDTH_PX,
    viewportWidth - reservedChromePx - minStagePx,
  );
  const absolute = clampSidebarWidth(widthPx);
  return Math.min(absolute, maxFromViewport);
}

export function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) {
      return SIDEBAR_DEFAULT_WIDTH_PX;
    }
    return clampSidebarWidth(Number(raw));
  } catch {
    return SIDEBAR_DEFAULT_WIDTH_PX;
  }
}

export function saveSidebarWidth(widthPx: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampSidebarWidth(widthPx)));
  } catch {
    // private mode / SSR — ignore
  }
}

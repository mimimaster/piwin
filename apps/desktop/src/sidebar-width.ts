/**
 * Left navigator width: pure clamp + localStorage persistence.
 * CSS consumes the value via --sidebar-width on .app-shell.
 */

export const SIDEBAR_DEFAULT_WIDTH_PX = 300;
export const SIDEBAR_MIN_WIDTH_PX = 300;
export const SIDEBAR_MAX_WIDTH_PX = 420;
/** Extra px past min width before drag-to-collapse fires. */
export const SIDEBAR_COLLAPSE_OVERSHOOT_PX = 24;

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

/**
 * After the navigator is already at min width, keep dragging the splitter
 * left (conversation grows) to collapse it.
 */
export function shouldCollapseSidebar(
  widthPx: number,
  overshootPx = SIDEBAR_COLLAPSE_OVERSHOOT_PX,
): boolean {
  if (!Number.isFinite(widthPx)) {
    return false;
  }
  return widthPx < SIDEBAR_MIN_WIDTH_PX - overshootPx;
}

/**
 * Reverse of drag-to-collapse: after the navigator is hidden, dragging the
 * splitter back to min width (24px hysteresis) expands it without pointer-up.
 */
export function shouldExpandSidebar(widthPx: number): boolean {
  if (!Number.isFinite(widthPx)) {
    return false;
  }
  return widthPx >= SIDEBAR_MIN_WIDTH_PX;
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

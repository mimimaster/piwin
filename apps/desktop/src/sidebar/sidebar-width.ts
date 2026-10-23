/**
 * Left navigator width: pure clamp + localStorage persistence.
 * CSS consumes the value via --sidebar-width on .app-shell.
 */

export const SIDEBAR_DEFAULT_WIDTH_PX = 300;
/** Kept below the default so the navigator can narrow before it collapses. */
export const SIDEBAR_MIN_WIDTH_PX = 220;
export const SIDEBAR_MAX_WIDTH_PX = 420;
/**
 * Drag-to-collapse fires only once the pointer would make the navigator
 * narrower than this. Between it and the min width the navigator holds at
 * min — a resistance band, so a slight overdrag never hides it.
 */
export const SIDEBAR_COLLAPSE_BELOW_PX = 140;

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
 * left (conversation grows) past the resistance band to collapse it.
 */
export function shouldCollapseSidebar(widthPx: number): boolean {
  if (!Number.isFinite(widthPx)) {
    return false;
  }
  return widthPx < SIDEBAR_COLLAPSE_BELOW_PX;
}

/**
 * Reverse of drag-to-collapse: after the navigator is hidden, dragging the
 * splitter back to min width expands it without pointer-up (the band between
 * the collapse threshold and min width is the hysteresis).
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

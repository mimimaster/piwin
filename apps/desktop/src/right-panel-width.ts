/**
 * Right workspace panel width: pure clamp + localStorage persistence.
 * CSS consumes the value via --right-panel-width on .app-shell.
 */

export const RIGHT_PANEL_DEFAULT_WIDTH_PX = 280;
export const RIGHT_PANEL_MIN_WIDTH_PX = 200;
export const RIGHT_PANEL_MAX_WIDTH_PX = 1600;
/** Chat/composer column that split view must preserve. */
export const RIGHT_PANEL_STAGE_MIN_PX = 420;
/** Extra remaining-stage px required before drag exits full width. */
export const RIGHT_PANEL_FULL_WIDTH_HYSTERESIS_PX = 24;

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
  const minStagePx = options?.minStagePx ?? RIGHT_PANEL_STAGE_MIN_PX;
  const reservedChromePx = options?.reservedChromePx ?? 0;
  const maxFromViewport = Math.max(
    RIGHT_PANEL_MIN_WIDTH_PX,
    viewportWidth - reservedChromePx - minStagePx,
  );
  const absolute = clampRightPanelWidth(widthPx);
  return Math.min(absolute, maxFromViewport);
}

export type RightPanelFullWidthInput = {
  panelWidthPx: number;
  viewportWidth: number;
  reservedChromePx?: number;
  minStagePx?: number;
};

function remainingStagePx(input: RightPanelFullWidthInput): number {
  const reservedChromePx = input.reservedChromePx ?? 0;
  return input.viewportWidth - reservedChromePx - input.panelWidthPx;
}

/** Split-view maximum: leave `minStagePx` for the chat column. */
export function splitViewMaxPanelWidth(
  viewportWidth: number,
  reservedChromePx = 0,
  minStagePx = RIGHT_PANEL_STAGE_MIN_PX,
): number {
  return Math.max(
    RIGHT_PANEL_MIN_WIDTH_PX,
    viewportWidth - reservedChromePx - minStagePx,
  );
}

/**
 * Codex overshoot: once the chat would fall below the split floor, eat the
 * conversation instead of clamping.
 */
export function shouldEnterRightPanelFullWidth(input: RightPanelFullWidthInput): boolean {
  const minStagePx = input.minStagePx ?? RIGHT_PANEL_STAGE_MIN_PX;
  return remainingStagePx(input) < minStagePx;
}

export function shouldExitRightPanelFullWidth(
  input: RightPanelFullWidthInput & { hysteresisPx?: number },
): boolean {
  const minStagePx = input.minStagePx ?? RIGHT_PANEL_STAGE_MIN_PX;
  const hysteresisPx = input.hysteresisPx ?? RIGHT_PANEL_FULL_WIDTH_HYSTERESIS_PX;
  return remainingStagePx(input) >= minStagePx + hysteresisPx;
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

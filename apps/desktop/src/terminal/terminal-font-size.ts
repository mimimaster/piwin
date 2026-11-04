/**
 * Terminal type size: one persisted number shared by every shell surface.
 *
 * ⌘+ / ⌘- is shell muscle memory, so the value has to survive a reload and
 * every new tab instead of living in one pane's component state.
 */

export const TERMINAL_FONT_SIZE_DEFAULT = 13;
export const TERMINAL_FONT_SIZE_MIN = 9;
export const TERMINAL_FONT_SIZE_MAX = 24;

const STORAGE_KEY = 'piwin:terminal-font-size';
const STEP_PX = 1;

export function clampTerminalFontSize(size: number): number {
  if (!Number.isFinite(size)) {
    return TERMINAL_FONT_SIZE_DEFAULT;
  }
  const rounded = Math.round(size);
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, rounded));
}

export function readTerminalFontSize(): number {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return TERMINAL_FONT_SIZE_DEFAULT;
    }
    return clampTerminalFontSize(Number(raw));
  } catch {
    // A blocked storage (private mode, disabled cookies) only costs the preference.
    return TERMINAL_FONT_SIZE_DEFAULT;
  }
}

export function writeTerminalFontSize(size: number): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(clampTerminalFontSize(size)));
  } catch {
    /* ignore: the size still applies for this session */
  }
}

export type TerminalFontStep = 'up' | 'down' | 'reset';

export function stepTerminalFontSize(current: number, step: TerminalFontStep): number {
  if (step === 'reset') {
    return TERMINAL_FONT_SIZE_DEFAULT;
  }
  return clampTerminalFontSize(current + (step === 'up' ? STEP_PX : -STEP_PX));
}

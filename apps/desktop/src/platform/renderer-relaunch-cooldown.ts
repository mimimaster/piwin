const RELAUNCH_ATTEMPT_KEY = 'piwin.desktop.renderer-relaunch-at.v1';

/** Session storage survives page reloads while keeping each shell's cooldown separate. */
export function readRendererRelaunchAttempt(): number | null {
  try {
    const value = window.sessionStorage.getItem(RELAUNCH_ATTEMPT_KEY);
    if (value === null) return null;
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
  } catch (error) {
    console.warn('[renderer-self-heal] cannot read relaunch cooldown:', error);
    return null;
  }
}

export function recordRendererRelaunchAttempt(timestamp: number): void {
  try {
    window.sessionStorage.setItem(RELAUNCH_ATTEMPT_KEY, String(timestamp));
  } catch (error) {
    console.warn('[renderer-self-heal] cannot persist relaunch cooldown:', error);
  }
}

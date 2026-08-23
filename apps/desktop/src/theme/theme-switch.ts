/**
 * Transition freezing around a theme flip.
 *
 * Without this, the hundreds of color and shadow transitions in the cascade all
 * animate at once when tokens change, and the shell appears to smear rather
 * than switch. Freezing for a single paint makes the flip instantaneous.
 */

const THEME_SWITCHING_CLASS = 'is-theme-switching';
const SETTLE_MS = 64;

let settleTimer: ReturnType<typeof setTimeout> | null = null;

export function beginThemeSwitch(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.classList.add(THEME_SWITCHING_CLASS);
  // Force the freeze to apply before token writes land in the same turn.
  void root.offsetHeight;

  if (settleTimer !== null) {
    clearTimeout(settleTimer);
  }

  const release = (): void => {
    settleTimer = setTimeout(() => {
      root.classList.remove(THEME_SWITCHING_CLASS);
      settleTimer = null;
    }, SETTLE_MS);
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(release);
    });
    return;
  }
  release();
}

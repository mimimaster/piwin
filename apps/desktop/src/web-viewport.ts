/**
 * VisualViewport metrics for the Web shell.
 * Layout CSS sizes the phone shell with --app-vv-height, which already ends at
 * the keyboard, so --app-keyboard-inset must never be added on top of it. The
 * inset only tells CSS the keyboard is up (it then covers the home indicator).
 * Callers clear both properties on teardown.
 */

export type WebViewportMetrics = {
  width: number;
  height: number;
  offsetTop: number;
  keyboardInset: number;
};

export const WEB_VIEWPORT_HEIGHT_VAR = '--app-vv-height';
export const WEB_VIEWPORT_KEYBOARD_INSET_VAR = '--app-keyboard-inset';

const FALLBACK_METRICS: WebViewportMetrics = {
  width: 1280,
  height: 800,
  offsetTop: 0,
  keyboardInset: 0,
};

export function fallbackWebViewportMetrics(): WebViewportMetrics {
  return FALLBACK_METRICS;
}

export function readWebViewportMetrics(view: Window): WebViewportMetrics {
  const visual = view.visualViewport;
  const width = Math.round(visual?.width ?? view.innerWidth);
  const height = Math.round(visual?.height ?? view.innerHeight);
  const offsetTop = Math.round(visual?.offsetTop ?? 0);
  const keyboardInset = Math.max(0, Math.round(view.innerHeight - height - offsetTop));
  return { width, height, offsetTop, keyboardInset };
}

/**
 * iOS pans the page to reveal a focused field when the keyboard opens. The
 * shell is already sized to the visual viewport, so that pan only pushes the
 * titleband under the status bar; the document must stay at the origin.
 * A pinch-zoomed page pans legitimately and is left alone.
 */
export function shouldResetDocumentScroll(view: Window): boolean {
  const visual = view.visualViewport;
  if (visual === null || visual === undefined) {
    return false;
  }
  const zoomed = Math.abs((visual.scale ?? 1) - 1) > 0.01;
  if (zoomed) {
    return false;
  }
  return visual.offsetTop > 0 || view.scrollY > 0;
}

export function applyWebViewportCssVars(
  root: HTMLElement,
  metrics: WebViewportMetrics,
): void {
  root.style.setProperty(WEB_VIEWPORT_HEIGHT_VAR, `${metrics.height}px`);
  root.style.setProperty(WEB_VIEWPORT_KEYBOARD_INSET_VAR, `${metrics.keyboardInset}px`);
}

export function clearWebViewportCssVars(root: HTMLElement): void {
  root.style.removeProperty(WEB_VIEWPORT_HEIGHT_VAR);
  root.style.removeProperty(WEB_VIEWPORT_KEYBOARD_INSET_VAR);
}

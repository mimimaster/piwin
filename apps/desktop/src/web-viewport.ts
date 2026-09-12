/**
 * VisualViewport metrics for the Web shell.
 * Layout CSS consumes --app-vv-height / --app-keyboard-inset; callers must
 * clear those properties on teardown so a remount cannot double-compensate.
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

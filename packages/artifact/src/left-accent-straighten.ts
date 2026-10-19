/**
 * Left accent straightener: a status bar on the left edge of a rounded card
 * must stay a straight vertical line.
 *
 * Models keep writing `border-left: 3px solid tone` (or an inset left
 * box-shadow) on an element that also has `border-radius`; the browser bends
 * that bar into a concave arc at both corners. The owner wants the bar
 * straight, without a model-facing prompt rule, so the host squares the two
 * left corners of exactly those elements. The right corners, fill and border
 * colors stay as the author wrote them.
 *
 * One function serves both renderers. The static renderer calls it on its
 * shadow root; the sandbox embeds its source text and runs it in the frame.
 * It must therefore stay self-contained: no imports, no module-level
 * references, no helper functions — only its two arguments and literals.
 */

type AccentElement = {
  closest(selector: string): unknown;
  /** Optional because a bare DOM `Element` has none; HTML and SVG elements do. */
  style?: { setProperty(name: string, value: string, priority: string): void };
};
type AccentStyle = Record<
  | 'borderTopLeftRadius'
  | 'borderBottomLeftRadius'
  | 'borderLeftStyle'
  | 'borderLeftWidth'
  | 'borderTopWidth'
  | 'borderRightWidth'
  | 'borderBottomWidth'
  | 'boxShadow',
  string
>;

/**
 * The slice of the DOM the straightener touches. This package is built
 * without the DOM library so it stays portable; a `ShadowRoot` / `Document`
 * and a `Window` satisfy these shapes structurally.
 */
export type ArtifactLeftAccentRoot = { querySelectorAll(selector: string): ArrayLike<AccentElement> };
export type ArtifactLeftAccentView = { getComputedStyle(element: AccentElement): AccentStyle };

/** Square the left corners of every rounded element with a left accent bar; returns how many. */
export function straightenLeftAccents(root: ArtifactLeftAccentRoot, view: ArtifactLeftAccentView): number {
  let count = 0;
  const elements = root.querySelectorAll('*');
  for (let index = 0; index < elements.length && index < 2000; index += 1) {
    const element = elements[index];
    if (!element || !element.style || element.closest('svg')) continue;
    const style = view.getComputedStyle(element);
    const topLeft = parseFloat(style.borderTopLeftRadius) || 0;
    const bottomLeft = parseFloat(style.borderBottomLeftRadius) || 0;
    if (topLeft <= 0 && bottomLeft <= 0) continue;
    const leftDrawn = style.borderLeftStyle !== 'none' && style.borderLeftStyle !== 'hidden';
    const left = leftDrawn ? parseFloat(style.borderLeftWidth) || 0 : 0;
    const otherSides = Math.max(
      parseFloat(style.borderTopWidth) || 0,
      parseFloat(style.borderRightWidth) || 0,
      parseFloat(style.borderBottomWidth) || 0,
    );
    // Computed shadows serialize as `<color> Xpx 0px 0px 0px inset`; a
    // positive X with no y/blur is a bar on the left edge.
    const inset = /(?:^|\s)(\d+(?:\.\d+)?)px 0px 0px(?: 0px)? inset/.exec(style.boxShadow || '');
    const insetBar = inset !== null && (parseFloat(inset[1] || '0') || 0) >= 2;
    if (!(left >= 2 && left > otherSides) && !insetBar) continue;
    element.style.setProperty('border-top-left-radius', '0', 'important');
    element.style.setProperty('border-bottom-left-radius', '0', 'important');
    count += 1;
  }
  return count;
}

/**
 * Sandbox side: run after load and again whenever the document changes
 * (stream snapshots, author scripts building DOM). Only `childList` is
 * observed, so the inline styles it writes never retrigger it.
 * Expects `warnBridge` from the bridge bootstrap.
 */
export function buildArtifactLeftAccentRuntime(): string {
  return `
  var straightenLeftAccents = ${straightenLeftAccents.toString()};
  var leftAccentTimer = 0;
  var runLeftAccents = function () {
    leftAccentTimer = 0;
    try { straightenLeftAccents(document, window); } catch (error) { warnBridge('piwin artifact left accent straighten failed', error); }
  };
  var scheduleLeftAccents = function () {
    if (leftAccentTimer || !window.setTimeout) return;
    leftAccentTimer = window.setTimeout(runLeftAccents, 60);
  };
  if (typeof MutationObserver === 'function') {
    new MutationObserver(scheduleLeftAccents).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleLeftAccents, { once: true });
  else scheduleLeftAccents();
  window.addEventListener('load', scheduleLeftAccents);
`;
}

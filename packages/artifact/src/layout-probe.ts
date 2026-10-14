/**
 * Layout probe: finds text the layout squeezed into a column one glyph wide.
 *
 * The usual cause is a sentence written straight into a flex or grid row:
 * every bare text run and inline element becomes its own cell, and an inline
 * `code` lands in the narrow marker track, one character per line. Neither
 * renderer can repair that without guessing at the author's intent, so the
 * host only detects it and shows a badge (never a rewrite).
 *
 * One function serves both renderers. The static renderer calls it on its
 * shadow root; the sandbox embeds its source text and runs it in the frame.
 * It must therefore stay self-contained: no imports, no module-level
 * references, no helper functions — only its two arguments and literals.
 */
import { ARTIFACT_BRIDGE_LAYOUT_TYPE } from './constants.js';

type ProbeNode = { nodeType: number; nodeValue: string | null; nextSibling: ProbeNode | null };
type ProbeElement = {
  firstChild: ProbeNode | null;
  closest(selector: string): unknown;
  getBoundingClientRect(): { width: number; height: number };
};
type ProbeStyle = Record<
  | 'visibility'
  | 'writingMode'
  | 'fontSize'
  | 'lineHeight'
  | 'paddingLeft'
  | 'paddingRight'
  | 'borderLeftWidth'
  | 'borderRightWidth',
  string
>;

/**
 * The slice of the DOM the probe reads. This package is built without the DOM
 * library so it stays portable; a `ShadowRoot` / `Document` and a `Window`
 * satisfy these shapes structurally.
 */
export type ArtifactLayoutProbeRoot = { querySelectorAll(selector: string): ArrayLike<ProbeElement> };
export type ArtifactLayoutProbeView = { getComputedStyle(element: ProbeElement): ProbeStyle };

/** Number of elements whose own text is laid out about one glyph per line. */
export function countShatteredText(root: ArtifactLayoutProbeRoot, view: ArtifactLayoutProbeView): number {
  let count = 0;
  const elements = root.querySelectorAll('*');
  for (let index = 0; index < elements.length && index < 800; index += 1) {
    const element = elements[index];
    if (!element || element.closest('svg, script, style, [aria-hidden="true"]')) continue;
    let letters = 0;
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) letters += (child.nodeValue || '').replace(/\s+/g, '').length;
    }
    // A stack of one to three glyphs can be a deliberate vertical label.
    if (letters < 4) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = view.getComputedStyle(element);
    if (style.visibility === 'hidden') continue;
    if (style.writingMode && style.writingMode !== 'horizontal-tb') continue;
    const fontSize = parseFloat(style.fontSize) || 14;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
    const inner =
      rect.width -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0) -
      (parseFloat(style.borderLeftWidth) || 0) -
      (parseFloat(style.borderRightWidth) || 0);
    // One CJK glyph or two Latin letters wide, and at least four lines tall.
    if (inner <= fontSize * 1.3 && rect.height >= lineHeight * 3.5) count += 1;
  }
  return count;
}

/**
 * Sandbox side: run once after load and report only when something is wrong.
 * Expects `post(type, payload)` and `warnBridge` from the bridge bootstrap.
 */
export function buildArtifactLayoutProbeRuntime(): string {
  return `
  var layoutType = ${JSON.stringify(ARTIFACT_BRIDGE_LAYOUT_TYPE)};
  var countShatteredText = ${countShatteredText.toString()};
  var scheduleLayoutProbe = function () {
    if (!window.setTimeout) return;
    window.setTimeout(function () {
      try {
        var shattered = countShatteredText(document, window);
        if (shattered > 0) post(layoutType, { shatteredText: shattered });
      } catch (error) { warnBridge('piwin artifact layout probe failed', error); }
    }, 500);
  };
  if (document.readyState === 'complete') scheduleLayoutProbe();
  else window.addEventListener('load', scheduleLayoutProbe, { once: true });
`;
}

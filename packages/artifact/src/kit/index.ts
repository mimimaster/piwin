/**
 * Artifact kit v1: local chart + icon primitives (design.md §8).
 *
 * Delivery: the packaged desktop serves `kit.js` from the artifact scheme
 * (`/lib/v1/kit.js`, compiled into the binary); everywhere else (browser,
 * e2e, tests) the same bytes are inlined. Either way the kit is injected only
 * when the source uses it, and the CSS is always inlined (it is tiny and
 * `style-src` already allows inline).
 */
import { ARTIFACT_KIT_V1_ICONS } from './icons-v1.js';
import { ARTIFACT_KIT_V1_RUNTIME } from './kit-v1-runtime.js';

export const ARTIFACT_KIT_MAJOR = 1 as const;
export const ARTIFACT_KIT_VERSION_STRING = '1.0.0' as const;
export const ARTIFACT_KIT_V1_PATH = '/lib/v1/kit.js' as const;
export const ARTIFACT_KIT_V1_ICON_NAMES: readonly string[] = Object.keys(ARTIFACT_KIT_V1_ICONS);
export const ARTIFACT_KIT_CHART_KINDS = ['bar', 'line', 'donut', 'spark'] as const;

const USES_KIT = /data-piwin-(?:chart|icon)\b|\bpiwin\.(?:chart|icon|hydrate)\s*\(/;

/** True when the source references kit markup or the `piwin.*` API. */
export function usesArtifactKit(source: string): boolean {
  return USES_KIT.test(source);
}

/** The exact bytes of `kit.js` v1 (served file and inline fallback). */
export function buildArtifactKitV1Script(): string {
  return `/* piwin artifact kit ${ARTIFACT_KIT_VERSION_STRING} */
(function (ICONS) {
'use strict';
if (window.piwin && window.piwin.version) return;
${ARTIFACT_KIT_V1_RUNTIME}
})(${JSON.stringify(ARTIFACT_KIT_V1_ICONS)});
`;
}

/** Zero-specificity kit styles; colors only from theme tokens. */
export function buildArtifactKitCss(): string {
  return `
:where(figure[data-piwin-chart]) { margin: 0 0 12px; min-width: 0; }
:where([data-piwin-chart] .piwin-chart-plot) { width: 100%; min-width: 0; }
:where([data-piwin-chart] svg) { display: block; max-width: 100%; height: auto; overflow: visible; }
:where([data-piwin-chart] > script) { display: none; }
:where([data-piwin-chart] .piwin-chart-axis) { stroke: var(--piwin-artifact-border); stroke-width: 1; }
:where([data-piwin-chart] text) { fill: var(--piwin-artifact-muted); font: 11px var(--piwin-artifact-font); }
:where([data-piwin-chart] text.piwin-chart-center) { fill: var(--piwin-artifact-text); font-size: 20px; font-weight: 700; }
:where([data-piwin-chart] figcaption) { margin-top: 6px; color: var(--piwin-artifact-muted); font-size: 12px; }
:where(.piwin-chart-legend) { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; color: var(--piwin-artifact-muted); font-size: 12px; }
:where(.piwin-chart-legend) i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; }
:where(figure[data-piwin-chart="spark"]) { display: inline-block; width: 96px; margin: 0; vertical-align: middle; }
:where([data-piwin-icon]) { display: inline-flex; width: 1em; height: 1em; line-height: 0; vertical-align: -0.15em; }
:where([data-piwin-icon] svg) { width: 100%; height: 100%; }
`;
}

export type ArtifactKitDelivery =
  | { kind: 'inline' }
  /** Origin of the artifact scheme, e.g. `piwin-artifact://localhost`. */
  | { kind: 'scheme'; origin: string };

let delivery: ArtifactKitDelivery = { kind: 'inline' };

/**
 * Desktop calls this once under Tauri, where documents load from the artifact
 * scheme. Browser/e2e builds keep the inline default.
 */
export function configureArtifactKitDelivery(next: ArtifactKitDelivery): void {
  delivery = next.kind === 'scheme' ? { kind: 'scheme', origin: next.origin.replace(/\/+$/, '') } : next;
}

export function getArtifactKitDelivery(): ArtifactKitDelivery {
  return delivery;
}

/** Extra `script-src` source for the scheme path; none for inline. */
export function artifactKitScriptSource(current: ArtifactKitDelivery = delivery): string | null {
  return current.kind === 'scheme' ? `${current.origin}/lib/v1/` : null;
}

/** Head markup that loads the kit for one document. */
export function buildArtifactKitHead(current: ArtifactKitDelivery = delivery): string {
  const css = `<style data-piwin-artifact-kit>${buildArtifactKitCss()}</style>`;
  if (current.kind === 'scheme') {
    const src = `${current.origin}${ARTIFACT_KIT_V1_PATH}`.replace(/"/g, '&quot;');
    return `${css}\n  <script data-piwin-artifact-kit src="${src}"></script>`;
  }
  const script = buildArtifactKitV1Script().replace(/<\/script/gi, '<\\/script');
  return `${css}\n  <script data-piwin-artifact-kit>${script}</script>`;
}

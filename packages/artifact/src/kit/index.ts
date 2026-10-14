/**
 * Artifact kit v1: local chart + icon primitives (design.md §8).
 *
 * Delivery: the packaged desktop serves `kit.js` from the artifact scheme
 * (`ARTIFACT_KIT_V1_PATH`, compiled into the binary); everywhere else (browser,
 * e2e, tests) the same bytes are inlined. Either way the kit is injected only
 * when the source uses it, and the CSS is always inlined (it is tiny and
 * `style-src` already allows inline).
 */
import { ARTIFACT_KIT_V1_ICONS } from './icons-v1.js';
import { ARTIFACT_KIT_V1_CHARTS } from './kit-v1-charts.js';
import { ARTIFACT_KIT_V1_RUNTIME } from './kit-v1-runtime.js';

export const ARTIFACT_KIT_MAJOR = 1 as const;
export const ARTIFACT_KIT_VERSION_STRING = '1.1.0' as const;
/**
 * The served URL carries the kit version because the scheme answers with an
 * immutable cache header: new bytes need a new URL, or an upgraded shell keeps
 * running the kit its webview cached. Keep in step with
 * `crates/artifact-webview/src/protocol.rs`.
 */
export const ARTIFACT_KIT_V1_PATH = '/lib/v1/kit-1.1.0.js' as const;
export const ARTIFACT_KIT_V1_ICON_NAMES: readonly string[] = Object.keys(ARTIFACT_KIT_V1_ICONS);
export const ARTIFACT_KIT_CHART_KINDS = ['bar', 'hbar', 'line', 'donut', 'stack', 'spark'] as const;

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
${ARTIFACT_KIT_V1_RUNTIME}${ARTIFACT_KIT_V1_CHARTS}
})(${JSON.stringify(ARTIFACT_KIT_V1_ICONS)});
`;
}

/** Zero-specificity kit styles; colors only from theme tokens. */
export function buildArtifactKitCss(): string {
  const line = (strength: number) => `color-mix(in srgb, var(--piwin-artifact-text) ${strength}%, transparent)`;
  return `
:where(figure[data-piwin-chart]) { margin: 0 0 14px; min-width: 0; }
:where([data-piwin-chart] .piwin-chart-plot) { width: 100%; min-width: 0; }
:where([data-piwin-chart] svg) { display: block; max-width: 100%; height: auto; overflow: visible; }
:where([data-piwin-chart] > script) { display: none; }
/* While a chart streams its figure has no data yet (the preview withholds the
   script), so hold its place: the page must not jump when the chart draws. A
   final figure always has its script, drawn or not, and gets no placeholder. */
:where(figure[data-piwin-chart]:not([data-piwin-chart-ready]):not(:has(> script)))::before {
  content: "";
  display: block;
  height: 180px;
  border-radius: 10px;
  background: repeating-linear-gradient(to bottom, transparent 0 40px, ${line(8)} 40px 41px), ${line(3)};
}
:where(figure[data-piwin-chart="donut"]:not([data-piwin-chart-ready]):not(:has(> script)))::before { width: 168px; height: 168px; border-radius: 50%; background: ${line(5)}; }
:where(figure[data-piwin-chart="hbar"]:not([data-piwin-chart-ready]):not(:has(> script)))::before { height: 120px; }
:where(figure[data-piwin-chart="stack"]:not([data-piwin-chart-ready]):not(:has(> script)))::before { height: 14px; border-radius: 5px; background: ${line(7)}; }
:where(figure[data-piwin-chart="spark"]:not([data-piwin-chart-ready]):not(:has(> script)))::before { height: 28px; border-radius: 4px; background: ${line(5)}; }
:where([data-piwin-chart] .piwin-chart-axis) { stroke: ${line(26)}; stroke-width: 1; }
:where([data-piwin-chart] .piwin-chart-grid) { stroke: ${line(9)}; stroke-width: 1; }
:where([data-piwin-chart] .piwin-chart-track) { fill: ${line(7)}; }
:where([data-piwin-chart] .piwin-chart-bar) { transition: opacity 0.12s ease; }
:where([data-piwin-chart] .piwin-chart-bar:hover) { opacity: 0.78; }
/* The fill under a line must not swallow the hover that reveals a point's value. */
:where([data-piwin-chart] .piwin-chart-area) { pointer-events: none; }
:where([data-piwin-chart] .piwin-chart-dot) { stroke: var(--piwin-artifact-surface); stroke-width: 1.5; }
:where([data-piwin-chart] text) { fill: var(--piwin-artifact-muted); font: 11px var(--piwin-artifact-font); font-variant-numeric: tabular-nums; }
:where([data-piwin-chart] text.piwin-chart-tick, [data-piwin-chart] text.piwin-chart-label) { fill: var(--piwin-artifact-muted); }
:where([data-piwin-chart] text.piwin-chart-value) { fill: var(--piwin-artifact-text); font-weight: 600; }
:where([data-piwin-chart] [data-kind="hbar"] text.piwin-chart-label) { fill: var(--piwin-artifact-text); font-size: 12px; }
:where([data-piwin-chart] text.piwin-chart-center) { fill: var(--piwin-artifact-text); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
:where([data-piwin-chart] figcaption) { margin-top: 8px; color: var(--piwin-artifact-muted); font-size: 12px; line-height: 1.5; }
:where(.piwin-chart-legend) { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; color: var(--piwin-artifact-muted); font: 12px var(--piwin-artifact-font); }
:where(.piwin-chart-legend span) { display: inline-flex; align-items: center; gap: 6px; }
:where(.piwin-chart-legend i) { flex: none; width: 9px; height: 9px; border-radius: 3px; }
:where(.piwin-chart-legend b) { margin-left: 2px; color: var(--piwin-artifact-text); font-weight: 600; font-variant-numeric: tabular-nums; }
/* A donut sits beside its legend, which then reads as a small table. */
:where(.piwin-chart-plot[data-kind="donut"]) { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; }
:where(.piwin-chart-plot[data-kind="donut"] svg) { flex: none; }
:where(.piwin-chart-plot[data-kind="donut"] .piwin-chart-legend) { flex: 1 1 8rem; flex-direction: column; gap: 7px; margin-top: 0; }
:where(.piwin-chart-plot[data-kind="donut"] .piwin-chart-legend b) { margin-left: auto; }
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

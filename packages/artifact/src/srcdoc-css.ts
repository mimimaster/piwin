/**
 * Theme, motion, and four ArtifactFrameMode CSS contracts for sandbox srcdoc.
 * Overflow/scroll ownership lives in the late cascade so model CSS cannot
 * create a second scrollport.
 */
import type { ArtifactThemeVariables } from './types.js';

function escapeCssValue(value: string): string {
  return value.replace(/[;{}]/g, '').trim();
}

export function buildArtifactThemeCss(theme: ArtifactThemeVariables): string {
  const variables = Object.entries(theme)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, value]) => `  ${name}: ${escapeCssValue(value)};`)
    .join('\n');
  const colorScheme = theme['--piwin-artifact-theme'] === 'dark' ? 'dark' : 'light';
  return `
:root {
${variables}
  color-scheme: ${colorScheme};
}
html {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  background: transparent;
}
*, *::before, *::after { box-sizing: inherit; }
body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  background: transparent;
  color: var(--piwin-artifact-text);
  font-family: var(--piwin-artifact-font);
  font-size: var(--piwin-artifact-font-size, medium);
  line-height: var(--piwin-artifact-line-height, normal);
  letter-spacing: var(--piwin-artifact-letter-spacing, normal);
  -webkit-font-smoothing: var(--piwin-artifact-font-smoothing, auto);
  overflow-wrap: break-word;
}
img, svg, canvas, video { max-width: 100%; height: auto; }
html[data-frame-mode="canvas"] img,
html[data-frame-mode="canvas"] svg,
html[data-frame-mode="canvas"] canvas,
html[data-frame-mode="canvas"] video {
  max-height: none;
}
.piwin-artifact-root > svg {
  display: block;
  width: auto;
  max-width: 100% !important;
  height: auto;
  margin-inline: auto;
  background: transparent;
  overflow: visible;
}
a { color: var(--piwin-artifact-accent); }
button, input, select, textarea { font: inherit; }
code {
  font-family: var(--piwin-artifact-font-mono, ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace);
  font-size: 0.875em;
  padding: 1.5px 6px;
  border-radius: var(--piwin-artifact-radius, 4px);
  background: color-mix(in srgb, var(--piwin-artifact-text) 8%, transparent);
  color: var(--piwin-artifact-text);
  border: 1px solid color-mix(in srgb, var(--piwin-artifact-text) 9%, transparent);
  font-weight: 450;
}
pre code {
  background: transparent;
  border: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
  color: inherit;
}
.piwin-artifact-root,
.artifact-root,
.owi-artifact-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: 4px 0;
  background: transparent;
  color: var(--piwin-artifact-text);
  overflow-x: hidden;
  box-sizing: border-box;
}
.piwin-artifact-root > :not(svg) {
  align-self: stretch;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.piwin-artifact-surface {
  background: var(--piwin-artifact-surface);
  color: var(--piwin-artifact-text);
  border-radius: var(--piwin-artifact-radius);
}
.piwin-artifact-root iframe {
  display: block;
  width: 100%;
  max-width: 100%;
  border: 0;
}
.piwin-artifact-root iframe[src*="youtube.com/embed"],
.piwin-artifact-root iframe[src*="youtube-nocookie.com/embed"] {
  aspect-ratio: 16 / 9;
  min-height: 180px;
}
.piwin-artifact-root iframe[src*="google.com/maps"],
.piwin-artifact-root iframe[src*="maps.google.com"] {
  height: 360px;
  max-height: 480px;
  min-height: 240px;
}
html[data-frame-mode="inline-flow"] .piwin-artifact-root {
  container-type: inline-size;
  overflow: visible !important;
}
html[data-frame-mode="inline-flow"] .piwin-artifact-root > *,
html[data-frame-mode="inline-flow"] .piwin-artifact-root img,
html[data-frame-mode="inline-flow"] .piwin-artifact-root svg,
html[data-frame-mode="inline-flow"] .piwin-artifact-root canvas,
html[data-frame-mode="inline-flow"] .piwin-artifact-root video,
html[data-frame-mode="inline-flow"] .piwin-artifact-root iframe,
html[data-frame-mode="inline-flow"] .piwin-artifact-root table,
html[data-frame-mode="inline-flow"] .piwin-artifact-root pre {
  min-width: 0 !important;
  max-width: 100% !important;
}
html[data-frame-mode="inline-flow"] .piwin-artifact-root pre,
html[data-frame-mode="inline-flow"] .piwin-artifact-root code {
  white-space: pre-wrap !important;
  overflow-wrap: anywhere;
  word-break: break-word;
}
html[data-frame-mode="inline-flow"] .piwin-artifact-root table {
  width: 100% !important;
  table-layout: fixed;
}
html[data-frame-mode="inline-flow"] .piwin-artifact-root th,
html[data-frame-mode="inline-flow"] .piwin-artifact-root td {
  overflow-wrap: anywhere;
}
`;
}

export function buildArtifactMotionPolicyCss(): string {
  return `
@media (prefers-reduced-motion: reduce) {
.piwin-artifact-root,
.piwin-artifact-root *,
.piwin-artifact-root *::before,
.piwin-artifact-root *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
.piwin-artifact-root animate,
.piwin-artifact-root animateMotion,
.piwin-artifact-root animateTransform,
.piwin-artifact-root set {
  display: none !important;
}
}
`;
}

export function buildArtifactThemeGuardCss(): string {
  return `
html,
body,
.piwin-artifact-root,
.artifact-root,
.owi-artifact-root {
  background: transparent !important;
  color: var(--piwin-artifact-text) !important;
  color-scheme: var(--piwin-artifact-theme) !important;
}
.piwin-artifact-surface,
.bg-white,
.bg-gray-50,
.bg-gray-100,
.bg-gray-200,
.bg-gray-300,
[class*="bg-[rgba(255" i],
[class*="bg-[#fff" i],
[class*="bg-[#fafafa" i],
[class*="bg-[#f5f5f5" i],
[style*="background: white" i],
[style*="background-color: white" i],
[style*="background: #fff" i],
[style*="background-color: #fff" i],
[style*="background: #fafafa" i],
[style*="background-color: #fafafa" i],
[style*="background: #f5f5f5" i],
[style*="background-color: #f5f5f5" i],
[style*="background: rgb(255" i],
[style*="background-color: rgb(255" i],
[style*="background: rgb(250" i],
[style*="background-color: rgb(250" i],
[style*="background: rgba(255" i],
[style*="background-color: rgba(255" i],
[style*="background: rgba(250" i],
[style*="background-color: rgba(250" i] {
  background: var(--piwin-artifact-surface) !important;
  color: var(--piwin-artifact-text);
}
`;
}

/**
 * Unique scroll owner per frameMode. Flow: transcript owns scroll.
 * Viewport / overflow / canvas: body is the only document scrollport.
 */
export function buildArtifactFrameModePolicyCss(): string {
  return `
html[data-frame-mode="inline-flow"] {
  min-height: auto !important;
  height: auto !important;
  overflow-x: hidden !important;
  overflow-y: hidden !important;
}
html[data-frame-mode="inline-flow"] body {
  min-height: auto !important;
  height: auto !important;
  overflow-x: hidden !important;
  overflow-y: hidden !important;
}
html[data-frame-mode="inline-flow"][data-measurement-fallback="true"] {
  min-height: 100% !important;
  height: 100% !important;
}
html[data-frame-mode="inline-flow"][data-measurement-fallback="true"] body {
  min-height: 100% !important;
  height: 100% !important;
  overflow-y: auto !important;
  overscroll-behavior: contain !important;
}
html[data-frame-mode="inline-flow"] body > *,
html[data-frame-mode="inline-flow"] body > div {
  min-height: auto !important;
}
html[data-frame-mode="inline-flow"] .piwin-artifact-root,
html[data-frame-mode="inline-flow"] .artifact-root,
html[data-frame-mode="inline-flow"] .owi-artifact-root {
  min-height: auto !important;
  height: auto !important;
  overflow: visible !important;
  min-width: 0 !important;
  max-width: 100% !important;
}
html[data-frame-mode="inline-flow"] .piwin-artifact-root > :not(svg) {
  min-width: 0 !important;
  max-width: 100% !important;
}
html[data-frame-mode="inline-viewport"],
html[data-frame-mode="inline-overflow"],
html[data-frame-mode="canvas"] {
  min-height: 100%;
  height: 100% !important;
  overflow: hidden !important;
}
html[data-frame-mode="inline-viewport"] body,
html[data-frame-mode="inline-overflow"] body,
html[data-frame-mode="canvas"] body {
  min-height: 100%;
  height: 100% !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  overscroll-behavior: contain !important;
}
html[data-frame-mode="inline-viewport"] .piwin-artifact-root,
html[data-frame-mode="inline-overflow"] .piwin-artifact-root,
html[data-frame-mode="canvas"] .piwin-artifact-root {
  min-height: 100%;
}
/* Canvas is a viewport, not a gallery mat. The iframe is the design size;
   host chrome must not center a phone card or add stage padding.
   Layout defaults sit at zero specificity (:where) so the author's own body
   layout (e.g. a vertically centered stage) still wins. */
html[data-frame-mode="canvas"] {
  container-type: size;
}
:where(html[data-frame-mode="canvas"] body) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: 0;
  box-sizing: border-box;
}
/* A full-height stage may give up spare room, but never shrink below its
   content: a tall document scrolls in body instead of being crushed into
   the panel height (cards overlapping, the last section cut off). */
:where(html[data-frame-mode="canvas"] body > *) {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  flex: 0 1 auto;
}
:where(html[data-frame-mode="canvas"] .piwin-artifact-root) {
  flex: 1 0 auto;
  align-items: stretch;
  justify-content: flex-start;
}
html[data-frame-mode="canvas"] body > svg,
html[data-frame-mode="canvas"] .piwin-artifact-root > svg {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  margin-inline: 0;
}
`;
}

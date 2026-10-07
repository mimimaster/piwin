/**
 * Report kit stylesheet (see `@piwin/contracts` `artifact-report-kit`).
 *
 * Every selector is wrapped in `:where()`, so the kit has zero specificity:
 * it is a default an author rule of any shape overrides, and a document that
 * never uses the root class is untouched. Colors come from the six theme
 * variables; the three status tones are fixed hues pulled toward the host
 * text color so they stay legible on paper and on ink.
 */
import { ARTIFACT_REPORT_KIT_ROOT_CLASS } from '@piwin/contracts';

const ROOT = `.${ARTIFACT_REPORT_KIT_ROOT_CLASS}`;

/** `:where(.piwin-report) :where(<selector>)` for each comma-separated part. */
function within(selector: string): string {
  return selector
    .split(',')
    .map((part) => `:where(${ROOT}) :where(${part.trim()})`)
    .join(',\n');
}

export function buildArtifactReportKitCss(): string {
  return `
:where(${ROOT}) {
  --piwin-kit-rule: color-mix(in srgb, var(--piwin-artifact-text) 9%, transparent);
  --piwin-kit-wash: color-mix(in srgb, var(--piwin-artifact-text) 4%, transparent);
  --piwin-kit-ok: color-mix(in srgb, #1f9d6b 80%, var(--piwin-artifact-text));
  --piwin-kit-warn: color-mix(in srgb, #c7860f 82%, var(--piwin-artifact-text));
  --piwin-kit-risk: color-mix(in srgb, #d5483f 84%, var(--piwin-artifact-text));
  --piwin-kit-tone: var(--piwin-artifact-muted);
  box-sizing: border-box;
  display: block;
  width: 100%;
  max-width: 54rem;
  margin: 0 auto;
  padding: clamp(24px, 5vh, 44px) clamp(20px, 5vw, 56px) 72px;
  color: var(--piwin-artifact-text);
  font-family: var(--piwin-artifact-font);
  font-size: 14.5px;
  line-height: 1.68;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
:where(${ROOT}[data-width="wide"]) {
  max-width: 76rem;
}
/* The chat column already has its own gutter and measure. */
:where(html[data-frame-mode="inline-flow"] ${ROOT}) {
  max-width: 100%;
  padding: 2px 0 6px;
}
:where([data-tone="ok"]) { --piwin-kit-tone: var(--piwin-kit-ok); }
:where([data-tone="warn"]) { --piwin-kit-tone: var(--piwin-kit-warn); }
:where([data-tone="risk"]) { --piwin-kit-tone: var(--piwin-kit-risk); }
:where([data-tone="accent"]) { --piwin-kit-tone: var(--piwin-artifact-accent); }

${within('h1, h2, h3, h4')} {
  margin: 0;
  color: var(--piwin-artifact-text);
  font-weight: 650;
  line-height: 1.3;
  text-wrap: balance;
}
${within('h1')} {
  font-size: 1.72em;
  letter-spacing: -0.014em;
  line-height: 1.22;
}
${within('h2')} {
  margin-top: 2.6em;
  margin-bottom: 0.7em;
  font-size: 1.16em;
  letter-spacing: -0.006em;
}
${within('h3')} {
  margin-top: 1.7em;
  margin-bottom: 0.45em;
  font-size: 1em;
}
${within('h4')} {
  margin-top: 1.5em;
  margin-bottom: 0.4em;
  color: var(--piwin-artifact-muted);
  font-size: 0.78em;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
${within('p')} {
  margin: 0 0 0.85em;
  text-wrap: pretty;
}
${within('ul, ol')} {
  margin: 0 0 0.95em;
  padding-left: 1.35em;
}
${within('li')} {
  margin: 0.28em 0;
}
${within('li::marker')} {
  color: var(--piwin-artifact-muted);
}
${within('strong, b')} {
  font-weight: 650;
}
${within('a')} {
  color: var(--piwin-artifact-accent);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}
${within('hr')} {
  height: 0;
  margin: 2.2em 0;
  border: 0;
  border-top: 1px solid var(--piwin-kit-rule);
}
${within('blockquote')} {
  margin: 1.1em 0;
  padding: 0.1em 0 0.1em 1em;
  border-left: 2px solid var(--piwin-artifact-border);
  color: var(--piwin-artifact-muted);
}
${within('pre')} {
  margin: 1em 0;
  padding: 12px 14px;
  overflow-x: auto;
  border: 1px solid var(--piwin-kit-rule);
  border-radius: 8px;
  background: var(--piwin-kit-wash);
  font-family: var(--piwin-artifact-font-mono, ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace);
  font-size: 0.86em;
  line-height: 1.62;
  tab-size: 2;
}
${within('figure')} {
  margin: 1.4em 0;
}
${within('figcaption')} {
  margin-top: 0.5em;
  color: var(--piwin-artifact-muted);
  font-size: 0.86em;
}
${within('table')} {
  width: 100%;
  margin: 1em 0 1.3em;
  border-collapse: collapse;
  font-size: 0.93em;
  line-height: 1.5;
}
${within('th, td')} {
  padding: 0.6em 0.9em;
  border-bottom: 1px solid var(--piwin-kit-rule);
  text-align: left;
  vertical-align: top;
  overflow-wrap: break-word;
}
${within('th')} {
  border-bottom-color: var(--piwin-artifact-border);
  color: var(--piwin-artifact-muted);
  font-size: 0.86em;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
${within('th:first-child, td:first-child')} {
  padding-left: 0;
}
${within('th:last-child, td:last-child')} {
  padding-right: 0;
}
${within('tbody tr:last-child > td')} {
  border-bottom: 0;
}
${within('details')} {
  margin: 0.9em 0;
  border: 1px solid var(--piwin-kit-rule);
  border-radius: 10px;
  padding: 0.15em 0.95em;
}
${within('summary')} {
  padding: 0.6em 0;
  cursor: pointer;
  font-weight: 600;
}
${within('header')} {
  margin-bottom: 1.8em;
}
${within('section + section')} {
  margin-top: 2.4em;
}
${within('.piwin-meta')} {
  margin: 0.5em 0 0;
  color: var(--piwin-artifact-muted);
  font-size: 0.88em;
  line-height: 1.5;
}
${within('.piwin-lede')} {
  margin: 0.9em 0 1.5em;
  font-size: 1.12em;
  line-height: 1.62;
}
${within('.piwin-muted')} {
  color: var(--piwin-artifact-muted);
}
${within('.piwin-scroll')} {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
${within('.piwin-callout')} {
  margin: 1.2em 0;
  padding: 0.85em 1.05em;
  border: 1px solid color-mix(in srgb, var(--piwin-kit-tone) 26%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--piwin-kit-tone) 7%, transparent);
}
${within('.piwin-badge')} {
  display: inline-flex;
  align-items: center;
  margin: 0 0.15em;
  padding: 0.05em 0.62em;
  border-radius: 999px;
  background: color-mix(in srgb, var(--piwin-kit-tone) 14%, transparent);
  color: color-mix(in srgb, var(--piwin-kit-tone) 88%, var(--piwin-artifact-text));
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.6;
  vertical-align: 0.08em;
  white-space: nowrap;
}
${within('.piwin-grid')} {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr));
  gap: 12px;
  margin: 1.2em 0;
}
${within('.piwin-card, .piwin-stat')} {
  min-width: 0;
  margin: 0;
  padding: 0.95em 1.1em;
  border: 1px solid var(--piwin-artifact-border);
  border-radius: 12px;
  background: var(--piwin-artifact-surface);
}
${within('.piwin-card:not(.piwin-grid > *)')} {
  margin: 1em 0;
}
${within('.piwin-stat')} {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
}
${within('.piwin-stat > span, .piwin-stat > small')} {
  color: var(--piwin-artifact-muted);
  font-size: 0.84em;
  line-height: 1.45;
}
${within('.piwin-stat > strong, .piwin-stat > b')} {
  color: var(--piwin-artifact-text);
  font-size: 1.75em;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 1.2;
}
${within('.piwin-stat[data-tone] > strong, .piwin-stat[data-tone] > b')} {
  color: var(--piwin-kit-tone);
}
${within('.piwin-kv')} {
  display: grid;
  grid-template-columns: minmax(5.5em, max-content) minmax(0, 1fr);
  gap: 0.55em 1.4em;
  margin: 0.9em 0;
}
${within('.piwin-kv > dt')} {
  color: var(--piwin-artifact-muted);
  font-size: 0.9em;
  line-height: 1.75;
}
${within('.piwin-kv > dd')} {
  min-width: 0;
  margin: 0;
}
/* Last in the zero-specificity cascade: a block that opens or closes its
   container sits flush with it, whatever margin its own rule asked for. */
:where(${ROOT} > :first-child),
:where(${ROOT}) :where(section, article, header, details, .piwin-card, .piwin-callout) > :where(:first-child) {
  margin-top: 0;
}
:where(${ROOT} > :last-child),
:where(${ROOT}) :where(section, article, header, .piwin-card, .piwin-callout) > :where(:last-child) {
  margin-bottom: 0;
}
/* Inline code reads as a token, not a pill, whatever the host radius is. */
${ROOT} code {
  border-radius: 5px;
}
${ROOT} pre code {
  border-radius: 0;
}
/* The page measure must survive the host's own stretch rules for a document's
   top-level block, so these two carry real specificity. */
html:not([data-frame-mode="inline-flow"]) .piwin-artifact-root > ${ROOT},
html:not([data-frame-mode="inline-flow"]) body > ${ROOT} {
  max-width: 54rem;
  margin-inline: auto;
}
html:not([data-frame-mode="inline-flow"]) .piwin-artifact-root > ${ROOT}[data-width="wide"],
html:not([data-frame-mode="inline-flow"]) body > ${ROOT}[data-width="wide"] {
  max-width: 76rem;
}
`;
}

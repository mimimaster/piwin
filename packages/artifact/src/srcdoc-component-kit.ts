/**
 * Component kit stylesheet (see `@piwin/contracts` `artifact-component-kit`).
 *
 * Same contract as the diagram kit: not scoped to `.piwin-report`, every
 * selector inside `:where()` so author CSS overrides it (pseudo-elements
 * aside), colors from theme variables only. Emitted last, so inside a report
 * the matrix table wins over the report's generic `table` rules.
 */

const mix = (token: string, percent: number, onto = 'transparent'): string =>
  `color-mix(in srgb, var(--piwin-artifact-${token}) ${percent}%, ${onto})`;
const SURFACE = 'var(--piwin-artifact-surface)';
const LINE = mix('text', 30);
const RULE = mix('text', 10);

/** Marker colors of a step / checklist item in a given state. */
function stateMarker(selector: string, token: string, glyph: string): string {
  return `
:where(${selector})::before {
  content: "${glyph}";
  border-color: ${mix(token, 55)};
  background: ${mix(token, 15, SURFACE)};
  color: var(--piwin-artifact-${token});
}`;
}

export function buildArtifactComponentKitCss(): string {
  return `
/* A tone works outside a report too: fall back to the status token itself. */
:where([data-tone="ok"]) { --piwin-kit-tone: var(--piwin-kit-ok, var(--piwin-artifact-ok)); }
:where([data-tone="warn"]) { --piwin-kit-tone: var(--piwin-kit-warn, var(--piwin-artifact-warn)); }
:where([data-tone="risk"]) { --piwin-kit-tone: var(--piwin-kit-risk, var(--piwin-artifact-risk)); }
:where([data-tone="info"]) { --piwin-kit-tone: var(--piwin-kit-info, var(--piwin-artifact-info)); }
:where([data-tone="accent"]) { --piwin-kit-tone: var(--piwin-artifact-accent); }

:where(.piwin-hero, .piwin-steps, .piwin-checklist, .piwin-progress, .piwin-compare, .piwin-matrix) {
  box-sizing: border-box;
  color: var(--piwin-artifact-text);
  font-family: var(--piwin-artifact-font);
  line-height: 1.5;
}
:where(.piwin-steps, .piwin-checklist) {
  margin: 1.3em 0;
  padding: 0;
  list-style: none;
}
:where(.piwin-steps > li, .piwin-checklist > li) :where(b, strong) {
  font-weight: 650;
}
:where(.piwin-steps > li) :where(small) {
  display: block;
  margin-top: 0.1em;
  color: var(--piwin-artifact-muted);
  font-size: 0.86em;
  font-weight: 400;
}

/* Hero: the page's masthead. Type and one rule give it weight; it sits on
   the page like the text below it rather than in a tinted box. */
:where(.piwin-hero) {
  margin: 0 0 1.6em;
  padding: 0 0 1.15em;
  border-bottom: 1px solid ${RULE};
}
:where(.piwin-hero) :where(h1, h2) {
  margin: 0;
  font-size: 1.6em;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.22;
  text-wrap: balance;
}
:where(.piwin-hero) :where(p) {
  margin: 0.55em 0 0;
  max-width: 46em;
}
:where(.piwin-hero) :where(.piwin-meta) {
  margin: 0 0 0.6em;
  color: var(--piwin-artifact-accent);
  font-size: 0.8em;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Steps: numbered markers on a rail; the state colors the marker. */
:where(.piwin-steps) {
  counter-reset: piwin-step;
}
:where(.piwin-steps > li) {
  position: relative;
  min-height: 26px;
  margin: 0;
  padding: 2px 0 1.25em 40px;
  counter-increment: piwin-step;
}
:where(.piwin-steps > li:last-child) {
  padding-bottom: 0;
}
:where(.piwin-steps > li)::before {
  content: counter(piwin-step);
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  border: 1.5px solid ${LINE};
  border-radius: 50%;
  background: ${SURFACE};
  color: var(--piwin-artifact-muted);
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 23px;
  text-align: center;
}
:where(.piwin-steps > li:not(:last-child))::after {
  content: "";
  position: absolute;
  top: 31px;
  bottom: 5px;
  left: 12.25px;
  width: 1.5px;
  border-radius: 1px;
  background: ${RULE};
}
:where(.piwin-steps > li[data-state="done"]:not(:last-child))::after {
  background: ${mix('ok', 45)};
}${stateMarker('.piwin-steps > li[data-state="done"]', 'ok', '✓')}${stateMarker('.piwin-steps > li[data-state="blocked"]', 'risk', '!')}
:where(.piwin-steps > li[data-state="current"])::before {
  border-color: var(--piwin-artifact-accent);
  color: var(--piwin-artifact-accent);
  box-shadow: 0 0 0 4px ${mix('accent', 16)};
}
:where(.piwin-steps > li:not([data-state])) {
  color: var(--piwin-artifact-muted);
}

/* Checklist: a box per item, filled in by its state. */
:where(.piwin-checklist > li) {
  position: relative;
  margin: 0;
  padding: 0.32em 0 0.32em 28px;
}
:where(.piwin-checklist > li)::before {
  content: "";
  position: absolute;
  top: 0.5em;
  left: 0;
  box-sizing: border-box;
  width: 17px;
  height: 17px;
  border: 1.5px solid ${LINE};
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}${stateMarker('.piwin-checklist > li[data-state="done"]', 'ok', '✓')}${stateMarker('.piwin-checklist > li[data-state="blocked"]', 'risk', '✕')}${stateMarker('.piwin-checklist > li[data-state="current"]', 'accent', '•')}
:where(.piwin-checklist > li[data-state="done"]) {
  color: var(--piwin-artifact-muted);
}

/* Progress: label and value on one line, the bar beneath. */
:where(.piwin-progress) {
  --piwin-progress: var(--piwin-artifact-accent);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px 12px;
  align-items: baseline;
  margin: 0.95em 0;
  font-size: 0.93em;
}
:where(.piwin-progress[data-tone]) {
  --piwin-progress: var(--piwin-kit-tone);
}
:where(.piwin-progress) > :where(b, strong, output) {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
:where(.piwin-progress) > :where(progress) {
  grid-column: 1 / -1;
  width: 100%;
  height: 8px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  background: ${mix('text', 8)};
  appearance: none;
  -webkit-appearance: none;
}
:where(.piwin-progress) > :where(progress)::-webkit-progress-bar {
  border-radius: 999px;
  background: transparent;
}
:where(.piwin-progress) > :where(progress)::-webkit-progress-value {
  border-radius: 999px;
  background: var(--piwin-progress);
}
:where(.piwin-progress) > :where(progress)::-moz-progress-bar {
  border-radius: 999px;
  background: var(--piwin-progress);
}

/* Compare: options side by side, the recommended one lifted. */
:where(.piwin-compare) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(13rem, 100%), 1fr));
  gap: 12px;
  align-items: stretch;
  margin: 1.3em 0;
}
:where(.piwin-compare > *) {
  box-sizing: border-box;
  min-width: 0;
  margin: 0;
  padding: 1em 1.15em;
  border: 1px solid var(--piwin-artifact-border);
  border-radius: 12px;
  background: ${SURFACE};
}
:where(.piwin-compare > [data-pick]) {
  border-color: var(--piwin-artifact-accent);
  background: ${mix('accent', 5, SURFACE)};
}
:where(.piwin-compare > *) > :where(h2, h3, h4) {
  margin: 0 0 0.45em;
  font-size: 1.04em;
  font-weight: 650;
}
:where(.piwin-compare > *) > :where(:first-child) { margin-top: 0; }
:where(.piwin-compare > *) > :where(:last-child) { margin-bottom: 0; }

/* Matrix: a table of filled cells, so status reads as a heat map. */
:where(.piwin-matrix) {
  width: 100%;
  margin: 1.3em 0;
  border-collapse: separate;
  border-spacing: 3px;
  font-size: 0.92em;
}
:where(.piwin-matrix) :where(th, td) {
  padding: 0.5em 0.65em;
  border: 0;
  border-radius: 6px;
  text-align: center;
  vertical-align: middle;
}
:where(.piwin-matrix) :where(th) {
  background: none;
  font-weight: 600;
  letter-spacing: 0;
  white-space: nowrap;
}
:where(.piwin-matrix) :where(thead th) {
  color: var(--piwin-artifact-muted);
  font-size: 0.88em;
}
:where(.piwin-matrix) :where(tbody th) {
  width: 1%;
  padding-left: 0;
  color: var(--piwin-artifact-text);
  font-size: 1em;
  text-align: left;
}
:where(.piwin-matrix) :where(td) {
  background: ${mix('text', 4)};
  font-variant-numeric: tabular-nums;
}
:where(.piwin-matrix) :where(td[data-tone]) {
  background: color-mix(in srgb, var(--piwin-kit-tone) 17%, transparent);
  color: color-mix(in srgb, var(--piwin-kit-tone) 72%, var(--piwin-artifact-text));
  font-weight: 600;
}

/* Trend: an arrow before a delta; its color comes from data-tone. */
:where([data-trend])::before {
  margin-right: 0.28em;
  font-size: 0.82em;
}
:where([data-trend="up"])::before { content: "▲"; }
:where([data-trend="down"])::before { content: "▼"; }
:where([data-trend="flat"])::before { content: "—"; }
:where([data-trend][data-tone]) {
  color: var(--piwin-kit-tone);
}
`;
}

/**
 * Diagram kit stylesheet (see `@piwin/contracts` `artifact-diagram-kit`).
 *
 * Unlike the report kit these shapes are not scoped to `.piwin-report`: a
 * flow or a swimlane is just as useful in a small Inline artifact. Selectors
 * stay inside `:where()` so any author rule overrides them (only the arrow
 * and rail pseudo-elements carry their own weight): the kit is a default the
 * model may restyle, never a lock. Colors come from the theme variables; a
 * step's tint follows the same `data-tone` variable the report kit sets.
 *
 * It is emitted after the report kit on purpose: inside a report the lanes
 * table must win over the report's generic `table` rules at equal weight.
 */

const CONTAINERS = '.piwin-flow, .piwin-lanes, .piwin-timeline, .piwin-tree';
const FLOW_STEP = '.piwin-flow > li';
const LANE_STEP = '.piwin-lanes td > p, .piwin-lanes td > div';
const TONE = 'var(--piwin-kit-tone, var(--piwin-artifact-muted))';

export function buildArtifactDiagramKitCss(): string {
  return `
:where(${CONTAINERS}) {
  --piwin-kit-ok: var(--piwin-artifact-ok);
  --piwin-kit-warn: var(--piwin-artifact-warn);
  --piwin-kit-risk: var(--piwin-artifact-risk);
  --piwin-kit-info: var(--piwin-artifact-info);
  --piwin-diagram-line: color-mix(in srgb, var(--piwin-artifact-text) 30%, transparent);
  --piwin-diagram-rule: color-mix(in srgb, var(--piwin-artifact-text) 10%, transparent);
  --piwin-diagram-wash: color-mix(in srgb, var(--piwin-artifact-text) 3.5%, transparent);
  box-sizing: border-box;
  color: var(--piwin-artifact-text);
  font-family: var(--piwin-artifact-font);
  line-height: 1.45;
}
:where(.piwin-flow, .piwin-timeline, .piwin-tree, .piwin-tree ul) {
  margin: 0;
  padding: 0;
  list-style: none;
}
:where(.piwin-flow, .piwin-timeline, .piwin-tree) {
  margin: 1.3em 0;
}

/* A step: the one node shape flows and lanes share. */
:where(${FLOW_STEP}, ${LANE_STEP}) {
  box-sizing: border-box;
  margin: 0;
  padding: 0.62em 0.9em;
  border: 1px solid var(--piwin-artifact-border);
  border-radius: 10px;
  background: var(--piwin-artifact-surface);
  box-shadow: var(--piwin-artifact-shadow-1);
  overflow-wrap: break-word;
}
/* A toned step keeps the neutral body and marks status with a straight
   left bar. An inset box-shadow would follow border-radius and look like a
   concave arc, so the bar is a linear-gradient layer instead. */
:where(${FLOW_STEP}, ${LANE_STEP}):where([data-tone]) {
  border-color: color-mix(in srgb, ${TONE} 38%, var(--piwin-artifact-border));
  background:
    linear-gradient(${TONE}, ${TONE}) 0 0 / 3px 100% no-repeat,
    color-mix(in srgb, ${TONE} 8%, var(--piwin-artifact-surface));
  box-shadow: var(--piwin-artifact-shadow-1);
}
:where(${FLOW_STEP}, .piwin-timeline > li) :where(b, strong) {
  font-weight: 650;
}
:where(${FLOW_STEP}, .piwin-timeline > li) :where(small) {
  display: block;
  margin-top: 0.15em;
  color: var(--piwin-artifact-muted);
  font-size: 0.84em;
  font-weight: 400;
}

/* Flow: steps in reading order, an arrow in each gap. */
:where(.piwin-flow) {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 12px 36px;
}
:where(${FLOW_STEP}) {
  position: relative;
  display: flex;
  flex: 1 1 7.5rem;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}
:where(.piwin-flow > li[data-kind="decision"]) {
  align-items: center;
  border-style: dashed;
  border-color: var(--piwin-diagram-line);
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  padding-inline: 1.2em;
  text-align: center;
}
:where(.piwin-flow > li + li)::before {
  content: "";
  position: absolute;
  top: 50%;
  left: -29px;
  width: 21px;
  border-top: 1.5px solid var(--piwin-diagram-line);
  transform: translateY(-50%);
}
:where(.piwin-flow > li + li)::after {
  content: "";
  position: absolute;
  top: 50%;
  left: -15px;
  width: 6px;
  height: 6px;
  border-top: 1.5px solid var(--piwin-diagram-line);
  border-right: 1.5px solid var(--piwin-diagram-line);
  transform: translateY(-50%) rotate(45deg);
}
:where(.piwin-flow[data-dir="down"]) {
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 30px;
}
:where(.piwin-flow[data-dir="down"] > li) {
  flex: 0 0 auto;
}
:where(.piwin-flow[data-dir="down"] > li + li)::before {
  top: -25px;
  left: 50%;
  width: 0;
  height: 19px;
  border-top: 0;
  border-left: 1.5px solid var(--piwin-diagram-line);
  transform: translateX(-50%);
}
:where(.piwin-flow[data-dir="down"] > li + li)::after {
  top: -13px;
  left: 50%;
  transform: translateX(-50%) rotate(135deg);
}

/* Swimlane: a table whose rows are actors and whose columns are phases. */
:where(.piwin-lanes) {
  width: 100%;
  margin: 1.3em 0;
  border: 1px solid var(--piwin-artifact-border);
  border-radius: 12px;
  border-collapse: separate;
  border-spacing: 0;
  counter-reset: piwin-phase;
  font-size: 0.93em;
}
:where(.piwin-lanes) :where(th, td) {
  padding: 0.7em 0.75em;
  border: 0;
  border-bottom: 1px solid var(--piwin-diagram-rule);
  border-left: 1px dashed var(--piwin-diagram-rule);
  text-align: left;
  vertical-align: middle;
  white-space: normal;
  overflow-wrap: break-word;
}
:where(.piwin-lanes) :where(tr > :first-child) {
  border-left: 0;
  padding-left: 1em;
}
:where(.piwin-lanes) :where(tr > :nth-child(2)) {
  border-left-style: solid;
}
:where(.piwin-lanes) :where(tr > :last-child) {
  padding-right: 0.75em;
}
:where(.piwin-lanes) :where(tbody tr:last-child > *) {
  border-bottom: 0;
}
:where(.piwin-lanes) :where(thead th) {
  padding-block: 0.6em;
  background: var(--piwin-diagram-wash);
  color: var(--piwin-artifact-muted);
  font-size: 0.86em;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
/* Phases are ordered, so each header carries its ordinal. */
:where(.piwin-lanes thead th:not(:first-child))::before {
  content: counter(piwin-phase);
  counter-increment: piwin-phase;
  display: inline-block;
  min-width: 1.55em;
  margin-right: 0.5em;
  border-radius: 999px;
  background: color-mix(in srgb, var(--piwin-artifact-text) 9%, transparent);
  color: var(--piwin-artifact-text);
  font-size: 0.92em;
  font-variant-numeric: tabular-nums;
  line-height: 1.55;
  text-align: center;
}
:where(.piwin-lanes) :where(tbody th) {
  width: 1%;
  background: var(--piwin-diagram-wash);
  color: var(--piwin-artifact-text);
  font-size: 1em;
  font-weight: 650;
  letter-spacing: 0;
  white-space: nowrap;
}
:where(.piwin-lanes) :where(thead tr:first-child > :first-child) { border-top-left-radius: 11px; }
:where(.piwin-lanes) :where(thead tr:first-child > :last-child) { border-top-right-radius: 11px; }
:where(.piwin-lanes) :where(tbody tr:last-child > :first-child) { border-bottom-left-radius: 11px; }
/* Wide enough that a short CJK label is not broken into two-character lines. */
:where(${LANE_STEP}) {
  min-width: 4.5em;
  padding: 0.45em 0.75em;
  border-radius: 8px;
}
:where(.piwin-lanes) :where(td > * + p, td > * + div) {
  margin-top: 6px;
}

/* Timeline: a rail with one haloed dot per event. */
:where(.piwin-timeline > li) {
  position: relative;
  margin: 0;
  padding: 0 0 1.25em 1.9em;
}
:where(.piwin-timeline > li:last-child) {
  padding-bottom: 0;
}
:where(.piwin-timeline > li)::before {
  content: "";
  position: absolute;
  top: 0.42em;
  left: 3px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: ${TONE};
  box-shadow: 0 0 0 4px color-mix(in srgb, ${TONE} 18%, transparent);
}
:where(.piwin-timeline > li:not(:last-child))::after {
  content: "";
  position: absolute;
  top: calc(0.42em + 17px);
  bottom: calc(-0.42em + 8px);
  left: 7px;
  width: 1.5px;
  border-radius: 1px;
  background: var(--piwin-diagram-rule);
}
:where(.piwin-timeline) :where(time) {
  display: block;
  margin-bottom: 0.1em;
  color: var(--piwin-artifact-muted);
  font-size: 0.82em;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* Tree: nested lists joined by elbow lines; the trunk stops at the last child. */
:where(.piwin-tree > li) {
  font-weight: 650;
}
:where(.piwin-tree ul) {
  margin-left: 0.45em;
  padding-left: 1.25em;
  font-weight: 400;
}
:where(.piwin-tree li) {
  position: relative;
  margin: 0;
  padding: 0.22em 0;
}
:where(.piwin-tree ul > li)::before {
  content: "";
  position: absolute;
  top: 0;
  left: -1.25em;
  width: 0.9em;
  height: 0.98em;
  border-bottom: 1px solid var(--piwin-diagram-line);
  border-left: 1px solid var(--piwin-diagram-line);
  border-bottom-left-radius: 5px;
}
:where(.piwin-tree ul > li:not(:last-child))::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -1.25em;
  border-left: 1px solid var(--piwin-diagram-line);
}
`;
}

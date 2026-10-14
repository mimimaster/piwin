/**
 * Diagram kit: host-styled shapes for information that has order, actors,
 * time or hierarchy.
 *
 * The report kit only offered boxes (`piwin-card`, `piwin-stat`), so every
 * process, handoff and timeline came back as a grid of cards. These classes
 * give the model a form per information shape without a `<style>` block and
 * without hand-placed SVG coordinates. They are optional: the contract tells
 * the model it may equally write its own CSS or inline SVG. Each one sits on semantic markup
 * (`ol`, `table`, nested `ul`), so a shell that predates the stylesheet still
 * shows a readable list or table.
 *
 * This file is the vocabulary both sides agree on. The stylesheet lives in
 * `@piwin/artifact` and must define a rule for every class listed here.
 */

export const ARTIFACT_DIAGRAM_KIT_CLASSES = [
  'piwin-flow',
  'piwin-lanes',
  'piwin-timeline',
  'piwin-tree',
] as const;

export type ArtifactDiagramKitClass = (typeof ARTIFACT_DIAGRAM_KIT_CLASSES)[number];

/**
 * Model-facing line of the Artifact runtime contract. It rides in the
 * resident conversation prompt (fixed token budget, CHT-803), so it names the
 * shapes and nothing else; markup examples live in the on-demand reference.
 */
export function formatArtifactDiagramKit(): string {
  return '- Diagram built-ins (optional, host-styled): `ol.piwin-flow` (steps joined by arrows), `table.piwin-lanes` (swimlane), `ol.piwin-timeline`, `ul.piwin-tree`; `artifact_instructions` has the markup. Inline `<svg viewBox>` in theme vars covers every other relation.';
}

/** Worked examples returned by `artifact_instructions` (not resident). */
export function formatArtifactDiagramKitReference(): string[] {
  return [
    'Diagrams (CSS only, they stream as written; usable in any artifact, inside or outside `piwin-report`):',
    '- Flow: `<ol class="piwin-flow"><li><b>Parse</b><small>fence → descriptor</small></li><li data-kind="decision">Trusted?</li><li data-tone="ok">Render</li></ol>`. Arrows join the steps. More than five steps or long text: add `data-dir="down"`.',
    '- Swimlane: `<table class="piwin-lanes"><thead><tr><th></th><th>Request</th><th>Review</th></tr></thead><tbody><tr><th>Client</th><td><p>1 Submit</p></td><td></td></tr><tr><th>Host</th><td></td><td><p data-tone="warn">2 Ask permission</p></td></tr></tbody></table>`. `thead` names the phases, each `tbody tr` is one actor, each step is a `p` in its phase cell; leave a cell empty when that actor does nothing there. Over four phases belongs on Canvas.',
    '- Timeline: `<ol class="piwin-timeline"><li data-tone="ok"><time>10-12</time><b>Shipped v14</b><small>Detail.</small></li></ol>`. Without `time` it doubles as a status-dot step list.',
    '- Tree: `<ul class="piwin-tree"><li>apps<ul><li>desktop</li><li>cli</li></ul></li></ul>`.',
    '- Anything else (architecture, graphs, state machines, arrows across lanes): inline `<svg viewBox="0 0 W H" style="width:100%;height:auto">`, strokes and fills from `var(--piwin-artifact-*)`, labels as real `<text>`.',
  ];
}

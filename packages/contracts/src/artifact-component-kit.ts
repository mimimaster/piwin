/**
 * Component kit: host-styled building blocks beyond boxes and diagrams.
 *
 * Each one is a class on semantic markup (`ol`, `ul`, `progress`, `table`,
 * `header`, `section`), styled by the sandbox with theme tokens only. They are
 * optional: the model may always write its own CSS. They exist because a
 * host-drawn component paints as it streams and cannot slip the way freehand
 * layout does, so the common shapes are worth having ready.
 *
 * This file is the vocabulary both sides agree on. The stylesheet lives in
 * `@piwin/artifact` and must define a rule for every class listed here.
 */

export const ARTIFACT_COMPONENT_KIT_CLASSES = [
  'piwin-hero',
  'piwin-steps',
  'piwin-checklist',
  'piwin-progress',
  'piwin-compare',
  'piwin-matrix',
] as const;

export type ArtifactComponentKitClass = (typeof ARTIFACT_COMPONENT_KIT_CLASSES)[number];

/** `data-state` values a step or checklist item may carry. Absent means not started. */
export const ARTIFACT_COMPONENT_KIT_STATES = ['done', 'current', 'blocked'] as const;

/** Compact vocabulary pointer retained for public API consumers. */
export function formatArtifactComponentKit(): string {
  return '- Component built-ins (optional, host-styled): `header.piwin-hero`, `ol.piwin-steps`, `ul.piwin-checklist`, `label.piwin-progress`, `section.piwin-compare`, `table.piwin-matrix`; `artifact_instructions` has the markup.';
}

/** Worked examples returned by `artifact_instructions` (not resident). */
export function formatArtifactComponentKitReference(): string[] {
  return [
    'Components (CSS only, they stream as written; usable in any artifact):',
    '- Hero: `<header class="piwin-hero"><p class="piwin-meta">Review · 10-13</p><h1>Title</h1><p>One-sentence conclusion.</p></header>`. One per artifact, at the top.',
    '- Steps: `<ol class="piwin-steps"><li data-state="done"><b>Parse</b><small>fence → descriptor</small></li><li data-state="current"><b>Render</b></li><li><b>Verify</b></li></ol>`. Numbered by the host; `data-state="done" | "current" | "blocked"`, absent = not started.',
    '- Checklist: `<ul class="piwin-checklist"><li data-state="done">Typecheck</li><li data-state="blocked">E2E</li><li>Release notes</li></ul>`. Same states as steps.',
    '- Progress: `<label class="piwin-progress"><span>Migration</span><b>72%</b><progress value="72" max="100"></progress></label>`; `data-tone` on the label colors the bar.',
    '- Compare: `<section class="piwin-compare"><article data-pick><h3>Option A</h3><p>Why.</p></article><article><h3>Option B</h3><p>Why.</p></article></section>`. `data-pick` marks the recommended option.',
    '- Matrix: `<table class="piwin-matrix"><thead><tr><th></th><th>CLI</th><th>Desktop</th></tr></thead><tbody><tr><th>Charts</th><td data-tone="ok">Yes</td><td data-tone="warn">Partial</td></tr></tbody></table>`. A toned cell is filled, so status reads as a heat map.',
    '- Trend: `<small data-trend="up" data-tone="ok">+12%</small>` (`up | down | flat`) puts an arrow before a delta, for example inside `piwin-stat`.',
  ];
}

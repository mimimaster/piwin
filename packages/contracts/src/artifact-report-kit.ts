/**
 * Report kit: the host-owned look of a written report inside an Artifact.
 *
 * A report used to arrive with a few kilobytes of model-written CSS in front
 * of its first visible word. Nothing can paint while that CSS streams, every
 * report restyles headings and tables slightly differently, and the reading
 * measure, spacing and contrast drift with the model. The kit moves that
 * styling into the sandbox: the model writes semantic HTML under one root
 * class and the host supplies the typography.
 *
 * This file is the vocabulary both sides agree on. The stylesheet lives in
 * `@piwin/artifact` and must define a rule for every class listed here.
 */

/** Root element of a kit document; every other kit class lives beneath it. */
export const ARTIFACT_REPORT_KIT_ROOT_CLASS = 'piwin-report' as const;

export const ARTIFACT_REPORT_KIT_CLASSES = [
  ARTIFACT_REPORT_KIT_ROOT_CLASS,
  'piwin-meta',
  'piwin-lede',
  'piwin-callout',
  'piwin-badge',
  'piwin-grid',
  'piwin-card',
  'piwin-stat',
  'piwin-kv',
  'piwin-scroll',
  'piwin-muted',
] as const;

export type ArtifactReportKitClass = (typeof ARTIFACT_REPORT_KIT_CLASSES)[number];

/** `data-tone` values a callout or badge may carry. Absent means neutral. */
export const ARTIFACT_REPORT_KIT_TONES = ['ok', 'warn', 'risk', 'accent'] as const;

export type ArtifactReportKitTone = (typeof ARTIFACT_REPORT_KIT_TONES)[number];

/**
 * Model-facing section of the Artifact runtime contract. It rides in the
 * resident conversation prompt, which has a fixed token budget (CHT-803), so
 * it names the vocabulary and nothing else.
 */
export function formatArtifactReportKit(): string[] {
  return [
    '### Report Kit (reports, reviews, audits, findings)',
    `The sandbox already styles reports. Wrap one in \`<main class="${ARTIFACT_REPORT_KIT_ROOT_CLASS}">\` (\`data-width="wide"\` for dense tables) and write plain semantic HTML — \`h1\`–\`h3\`, \`p\`, lists, \`table\`, \`blockquote\`, \`pre\`, \`details\` — with no \`<style>\` block, so content shows as it is written.`,
    'Classes: `piwin-meta` (line under `h1`), `piwin-lede` (the conclusion), `piwin-callout`, `piwin-badge`, `piwin-grid` of `piwin-card` / `piwin-stat` (`span` label, `strong` value, `small` note), `piwin-kv` on a `dl`, `piwin-scroll` (wide table), `piwin-muted`.',
    '`data-tone="ok" | "warn" | "risk" | "accent"` on callout, badge or stat; `risk` only for real problems. Add CSS only for what the kit lacks. Custom looks, prototypes and games skip the kit.',
  ];
}

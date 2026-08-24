/**
 * Artifact constants, configuration types, and model-facing protocol
 * shared across packages. Renderer runtime lives in @piwin/artifact.
 */

// ---------------------------------------------------------------------------
// Artifact configuration (PiwinConfig.artifact)
// ---------------------------------------------------------------------------

/**
 * Controls when the agent proactively generates artifacts.
 *
 * - `automatic`: the agent decides based on content value whether to use
 *   Markdown, an inline artifact, or a canvas artifact.
 * - `explicit-only`: artifacts are only produced when the user explicitly
 *   requests one (e.g. "make an artifact", "visualize this", "interactive page").
 */
export type ArtifactTriggerMode = 'automatic' | 'explicit-only';

/**
 * Whether the built-in or user-authored decision prompt is used.
 *
 * - `default`: piwin maintains the canonical prompt; upgrades apply automatically.
 * - `custom`: the user's text in `customPrompt` replaces the decision section.
 */
export type ArtifactPromptMode = 'default' | 'custom';

/** Where an artifact is rendered in the product UI. Declared in the fence. */
export type ArtifactSurface = 'inline' | 'canvas';

/**
 * Product-level artifact configuration stored under `~/.piwin/config.json`.
 */
export type ArtifactConfig = {
  /** Master switch. When false, no artifact prompt is injected and the heavy path is disabled. */
  enabled: boolean;
  /** Proactive vs. explicit-only artifact generation. */
  triggerMode: ArtifactTriggerMode;
  /** Decision prompt configuration (trigger + surface routing). */
  decisionPrompt: {
    mode: ArtifactPromptMode;
    /** Used only when mode is 'custom'. Empty string falls back to default. */
    customPrompt: string;
  };
  /** Security byte cap for artifact evaluation. */
  maxBytes: number;
};

// ---------------------------------------------------------------------------
// Artifact language aliases and runtime constants
// ---------------------------------------------------------------------------

/** Canonical model-output fence language. Parser-input aliases are not prompt-facing. */
export const CANONICAL_ARTIFACT_LANGUAGE = 'artifact-html' as const;

export const ARTIFACT_LANGUAGE_ALIASES = [
  CANONICAL_ARTIFACT_LANGUAGE,
  'artifact_html',
  'ui-html',
  'ui_html',
  'html-artifact',
] as const;

export const NATIVE_HTML_ARTIFACT_LANGUAGES = ['html', 'htm'] as const;

export const NATIVE_SVG_ARTIFACT_LANGUAGES = ['svg'] as const;

export const DEFAULT_MAX_ARTIFACT_BYTES = 100 * 1024;

/** Host tool that returns the decision policy + runtime contract on demand. */
export const ARTIFACT_INSTRUCTIONS_TOOL_NAME = 'artifact_instructions' as const;

/** Trigger constraint prefixed onto instructions whenever triggerMode is explicit-only. */
export const ARTIFACT_EXPLICIT_ONLY_HINT =
  'Use an Artifact only when the user explicitly requests an artifact, visualization, interactive page, prototype, or UI.';

export function createDefaultArtifactConfig(): ArtifactConfig {
  return {
    enabled: true,
    triggerMode: 'automatic',
    decisionPrompt: {
      mode: 'default',
      customPrompt: '',
    },
    maxBytes: DEFAULT_MAX_ARTIFACT_BYTES,
  };
}

// ---------------------------------------------------------------------------
// Default artifact decision prompt
// ---------------------------------------------------------------------------

/**
 * The canonical artifact decision prompt. This is the *configurable* part
 * that tells the model when to choose Markdown vs. artifact, and when to
 * choose inline vs. canvas. Surface rules (theme, layout, fence format)
 * come from `formatArtifactProtocol` and must not be restated here.
 *
 * Users can replace this via `decisionPrompt.mode = 'custom'`.
 */
export const DEFAULT_ARTIFACT_DECISION_PROMPT = [
  '[piwin-prompt-meta kind="artifact:decision" version="3" applies="artifacts-enabled"]',
  '<artifact-decision-policy name="piwin-proactive-inline">',
  '## Artifact Decision Policy',
  '',
  '## Primary rule',
  "Choose the presentation that makes the user's information easiest to scan, understand, search, copy, compare, and reuse.",
  'Artifact is not limited to explicit UI requests. Use an Artifact proactively whenever a structured or information-dense response is materially more useful as a compact interactive or visually grouped UI than as a long Markdown block.',
  '',
  '### Use Artifact proactively when',
  '- The answer contains many items, categories, commands, options, examples, or reference entries',
  '- The user asks for a cheatsheet, reference guide, command summary, comparison, matrix, timeline, workflow, catalog, checklist, or categorized overview',
  '- The content benefits from search, filtering, copying, sorting, tabs, accordions, or grouping',
  '- A dense table, list, or long explanation would be difficult to scan as ordinary Markdown',
  '- The user is likely to save, revisit, compare, or repeatedly use the answer',
  '- The user asks for a dashboard, calculator, visual summary, interactive tool, prototype, or UI',
  '- The answer would otherwise become a long wall of text',
  '',
  'For dense textual content, prefer an Artifact even when the user does not explicitly mention UI, as long as the Artifact improves readability or reuse.',
  '',
  '### Use Markdown when',
  '- The answer is short and can be understood in one or two paragraphs',
  '- The user explicitly asks for Markdown, plain text, source code, raw HTML, or a code snippet',
  '- The user asks to explain, debug, teach, or review code and no interactive presentation is useful',
  '- A small list or simple table is clearer than an Artifact',
  '',
  '### Output choice',
  'If the answer is between a long Markdown response and a compact searchable, copyable, or visually grouped Artifact, choose the Artifact.',
  'Use Inline Artifact by default. Use Canvas only for full-page layouts, app-like prototypes, complex local state, or a workspace that needs to remain beside the conversation.',
  '',
  'Runtime contract (theme, layout, sandbox) is injected separately — do not restate it here.',
  '</artifact-decision-policy>',
].join('\n');

/**
 * Resolves the effective artifact decision prompt based on configuration.
 * Falls back to the default prompt when custom mode is selected but the
 * custom prompt is empty.
 */
export function resolveArtifactDecisionPrompt(config: ArtifactConfig): string {
  if (
    config.decisionPrompt.mode === 'custom' &&
    config.decisionPrompt.customPrompt.trim().length > 0
  ) {
    return config.decisionPrompt.customPrompt;
  }
  return DEFAULT_ARTIFACT_DECISION_PROMPT;
}

// ---------------------------------------------------------------------------
// Model-facing runtime protocol (fence format, theme, layout)
// ---------------------------------------------------------------------------

/**
 * Canonical output-surface rules. The only HTML fence language this formatter
 * may emit is `artifact-html`. Parser-input aliases stay out of prompts.
 */
export function formatArtifactProtocol(): string {
  return [
    '[piwin-prompt-meta kind="artifact:runtime" version="3" applies="artifacts-enabled"]',
    '## HTML Artifact Runtime Contract',
    '',
    '## Success',
    'A self-contained artifact fence that renders correctly in the chat column sandbox.',
    '',
    `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title"`,
    '<!-- body fragment: HTML/CSS + optional small inline JS -->',
    '```',
    '',
    'SVG: ```svg title="Short descriptive title"``` — self-contained, no external refs.',
    '',
    '## Constraints (break without these)',
    '- Colors: for proactive artifacts, use only `--piwin-artifact-*` theme vars (`surface`, `text`, `muted`, `accent`, `border`, `bg`) to adapt to host theme; for user-specified requests (e.g. custom SVG, HTML pages, or explicit UI designs), style freely with custom colors.',
    '- Outermost wrapper background: transparent; surface colors on inner cards only.',
    '- Layout for 360–760px chat column; fluid grids; not a full-page landing.',
    '- Inline grows with its content: no page-level or nested vertical scroll regions; let the conversation own vertical scrolling.',
    '- If the UI fundamentally needs horizontal scrolling or a wide workspace, declare `surface="canvas"`; never add horizontal scrolling to Inline.',
    '- Repeated cards/items are siblings — no card-in-card.',
    '- Main content is static HTML; JS only enhances. Content remains if JS fails.',
    '- No viewport-filling height (`100vh`/`100%`) or page-level overflow on html/body/outer wrapper.',
  ].join('\n');
}

/**
 * Fixed artifact runtime contract injected alongside the configurable
 * decision prompt. Always produced by `formatArtifactProtocol`.
 */
export const ARTIFACT_RUNTIME_CONTRACT = formatArtifactProtocol();

/**
 * Full model-facing Artifact instructions: configured decision policy plus
 * the shared runtime protocol. `artifact_instructions` and any default
 * prompt path must call this instead of concatenating surface rules.
 * Explicit-only is a product constraint, not part of the editable decision
 * prompt, so it is prefixed whenever `triggerMode === 'explicit-only'`.
 */
export function formatArtifactInstructions(config: ArtifactConfig): string {
  const parts = [
    config.triggerMode === 'explicit-only' ? ARTIFACT_EXPLICIT_ONLY_HINT : undefined,
    resolveArtifactDecisionPrompt(config),
    formatArtifactProtocol(),
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.join('\n\n');
}

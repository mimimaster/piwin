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
  '[piwin-prompt-meta kind="artifact:decision" version="5" applies="artifacts-enabled"]',
  '<artifact-decision-policy name="piwin-proactive-surfaces">',
  '## Decision Criteria',
  'Choose the format that maximizes scannability, filtering, copying, and reuse. Proactively use Artifacts for structured or information-dense content even without an explicit UI request.',
  '',
  '### 1. Ordinary Markdown (Default for simple text)',
  '- Short answers (1–2 paragraphs), direct code explanations, debugging, or simple snippets.',
  '- When the user explicitly requests plain text, Markdown, or raw code.',
  '',
  '### 2. Inline Artifact (`artifact-html` without surface attr)',
  '- Cheatsheets, command summaries, matrices, timelines, catalogs, checklists, or comparative tables.',
  '- Content benefiting from search, tabs, accordions, interactive filters, or grouping within the chat stream.',
  '',
  '### 3. Canvas Artifact (`artifact-html` with `surface="canvas"`)',
  '- Full app/page prototypes, multi-step flows with local state, interactive tools/calculators, or dashboards requiring a dedicated wide workspace.',
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
    '[piwin-prompt-meta kind="artifact:runtime" version="6" applies="artifacts-enabled"]',
    '## HTML Artifact Runtime Contract',
    '',
    '### Fences',
    `- **Inline**: \`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title"\`\`\``,
    `- **Canvas**: \`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title" surface="canvas"\`\`\``,
    '- **SVG**: ```svg title="Short descriptive title"``` — self-contained, no external refs.',
    '',
    '### Layout & Sizing',
    '- **Chat Width**: Fluid layout designed for 360–760px column. Outermost background must be `transparent` (apply surface colors to inner cards only).',
    '- **Canvas Viewport**: The Canvas iframe is the design viewport. Root layout (and the primary stage) uses `width: 100%` and `height: 100%` / `100dvh` of that iframe. Do not lock a phone/poster width or an `aspect-ratio` that letterboxes empty bars; extra panel width is scene/layout space.',
    '- **No Page Scrollbars**: Inline height must fit content naturally. Never use `100vh`, `height: 100%`, or root scroll containers. Use `surface="canvas"` if wide/horizontal workspace is needed.',
    '- **Hierarchy**: Flatten repeated items/cards as siblings (avoid card-in-card nesting).',
    '',
    '### Styling & Theme',
    '- **Proactive Artifacts**: Use host theme CSS variables: `--piwin-artifact-surface`, `--piwin-artifact-text`, `--piwin-artifact-muted`, `--piwin-artifact-accent`, `--piwin-artifact-border`, `--piwin-artifact-bg`.',
    '- **Explicit User Designs**: Free to use custom palettes when requested.',
    '',
    '### Streaming & Progressive Enhancement',
    '- **CSS First**: Emit complete `<style>` blocks before any visible HTML markup.',
    '- **Incremental Streaming**: Close each visual block before starting siblings so live preview renders cleanly.',
    '- **Static First**: Core content must exist in static HTML; use JS strictly for enhancement (content remains readable if JS fails).',
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

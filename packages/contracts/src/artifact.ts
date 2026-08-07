/**
 * Artifact constants, configuration types, and default decision prompt
 * shared across packages. Full runtime lives in @piwin/artifact.
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

export const ARTIFACT_LANGUAGE_ALIASES = [
  'artifact-html',
  'artifact_html',
  'ui-html',
  'ui_html',
  'html-artifact',
] as const;

export const NATIVE_HTML_ARTIFACT_LANGUAGES = ['html', 'htm'] as const;

export const NATIVE_SVG_ARTIFACT_LANGUAGES = ['svg'] as const;

export const DEFAULT_MAX_ARTIFACT_BYTES = 100 * 1024;

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
 * choose inline vs. canvas. The runtime contract (theme variables, layout
 * constraints, fence format) is maintained separately and always injected.
 *
 * Users can replace this via `decisionPrompt.mode = 'custom'`.
 */
export const DEFAULT_ARTIFACT_DECISION_PROMPT = [
  '## Artifact Decision Policy',
  '',
  '## Success',
  'Choose the lightest output that lets the user complete their job: Markdown by default; an Artifact only when interaction, structure, or reuse clearly beats prose.',
  '',
  '### Markdown when',
  '- User wants text, source, a short answer, or simple tables/lists',
  '- An artifact would only decorate the same content',
  '- You are uncertain',
  '',
  '### Artifact when',
  '- User asks for artifact / visual / dashboard / calculator / interactive tool',
  '- Content needs search, filter, copy, compare, or interaction',
  '- Diagram, chart, or visual structure is clearer than continuous text',
  '- User will save or return to it as a standalone reference',
  '- Iterating on an existing artifact',
  '',
  '### Inline vs Canvas',
  '**Inline** (default): diagrams, cheatsheets, small calculators, compact interactive explanations.',
  '**Canvas** only if at least one holds: user asks for canvas/full page; multi-step local state; app/page prototype to operate; dense workspace beside chat; must return a result to Composer.',
  'Length, charts, tabs, or a few controls alone do not justify Canvas. If uncertain → Inline.',
  '',
  '### Output fences',
  'HTML: ```artifact-html title="Short title"``` (add `surface="canvas"` when Canvas).',
  'SVG: ```svg title="Short title"``` for self-contained vector diagrams/icons.',
  'Runtime contract (theme, layout, sandbox) is injected separately — do not restate it here.',
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
// Runtime artifact types
// ---------------------------------------------------------------------------

export type ArtifactStatus =
  | 'idle'
  | 'streaming'
  | 'loading'
  | 'ready'
  | 'blocked-empty'
  | 'blocked-too-large'
  | 'blocked-external-resource'
  | 'timeout'
  | 'error';

export type ArtifactDescriptorBase = {
  id: string;
  title: string;
  source: string;
  rawLanguage: string;
  alias: string;
};

export type HtmlArtifactDescriptor = ArtifactDescriptorBase & {
  type: 'html';
};

export type SvgArtifactDescriptor = ArtifactDescriptorBase & {
  type: 'svg';
};

export type ArtifactDescriptor = HtmlArtifactDescriptor | SvgArtifactDescriptor;

export type ArtifactSecurityBlockReason =
  | 'blocked-empty'
  | 'blocked-too-large'
  | 'blocked-external-resource';

export type ArtifactSecurityResult = {
  canRender: boolean;
  blockReason: ArtifactSecurityBlockReason | null;
  byteSize: number;
};

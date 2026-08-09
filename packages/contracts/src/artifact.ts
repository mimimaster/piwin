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
  'blocked-empty' | 'blocked-too-large' | 'blocked-external-resource';

export type ArtifactSecurityResult = {
  canRender: boolean;
  blockReason: ArtifactSecurityBlockReason | null;
  byteSize: number;
};

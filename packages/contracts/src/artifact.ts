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
  'You can produce two kinds of visual output: **Markdown** (default) and **Artifacts** (self-contained HTML or SVG rendered in a sandboxed iframe).',
  '',
  '### Step 1 — Markdown or Artifact?',
  '',
  'Use **Markdown** when:',
  '- The user explicitly asks for Markdown, plain text, source code, or a short answer.',
  '- The answer is best expressed as prose, a short list, a simple table, or ordinary code.',
  '- The content is brief and conversational.',
  '- An artifact would merely decorate the same text without adding functional value.',
  '- You are uncertain.',
  '',
  'Use an **Artifact** when:',
  '- The user explicitly requests an artifact, visual component, dashboard, calculator, interactive tool, or visual reference.',
  '- The content benefits from **searching, filtering, copying, comparing, or interaction** — e.g. command cheatsheets, reference guides, comparison matrices, timelines, categorized quick references.',
  '- A **diagram, flowchart, chart, or visual structure** communicates more clearly than continuous text.',
  '- The content is a **data visualization** or benefits from visual grouping.',
  '- The user will likely **save, reuse, or return to** the output as a standalone reference.',
  '- You are modifying or iterating on an existing artifact.',
  '',
  '### Step 2 — Inline or Canvas?',
  '',
  'After deciding to use an artifact, choose its presentation surface.',
  '',
  '**Inline** (default) is appropriate for:',
  '- Diagrams, charts, flowcharts, comparison matrices, timelines.',
  '- Searchable references, command cheatsheets, copyable command lists.',
  '- Small calculators, filters, tabs, collapsible sections.',
  '- Compact interactive explanations.',
  '',
  '**Canvas** (right-side panel) is appropriate only when **at least one** of these applies:',
  '- The user explicitly requests Canvas, a right-side page, or a full interactive page.',
  '- The UI is a multi-step workflow whose local state must survive several interactions.',
  '- The primary deliverable is an application or page prototype that must be operated and evaluated.',
  '- The UI is a coordinated, detail-dense workspace that should remain visible beside the conversation.',
  '- The UI must return a selected or generated result to the Composer.',
  '',
  '**Do NOT** choose Canvas merely because the content is long, wide, visually rich, contains a chart or table, or includes tabs, filtering, animation, or a few controls.',
  '',
  'If uncertain, use **Inline**.',
  '',
  '### SVG Artifacts',
  '',
  'Use SVG artifacts for:',
  '- Standalone diagrams, illustrations, icons, or vector graphics that are self-contained.',
  '- The user requests an SVG diagram or vector graphic.',
  '- A visual is better expressed as scalable vector markup than HTML.',
  '',
  'Output SVG using a fenced code block:',
  '',
  '```svg title="Short descriptive title"',
  '<!-- self-contained SVG markup -->',
  '```',
  '',
  '### Output Format',
  '',
  'HTML artifacts:',
  '```artifact-html title="Short descriptive title"',
  '<!-- self-contained HTML/CSS and optional small inline JS -->',
  '```',
  '',
  'SVG artifacts:',
  '```svg title="Short descriptive title"',
  '<!-- self-contained SVG markup -->',
  '```',
  '',
  'When the surface is Canvas, add `surface="canvas"` to the fence info string:',
  '',
  '```artifact-html title="Title" surface="canvas"',
  '```',
  '',
  '```svg title="Title" surface="canvas"',
  '```',
  '',
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

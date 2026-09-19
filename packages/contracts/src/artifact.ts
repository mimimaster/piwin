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
  /**
   * When true (default), an external `<script src>` blocks render.
   * Ignored when {@link blockExternalResources} is also true — that already
   * covers scripts.
   */
  blockExternalScripts?: boolean;
  /** When true (default), any external resource blocks render. */
  blockExternalResources?: boolean;
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
    blockExternalScripts: true,
    blockExternalResources: true,
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
  '[piwin-prompt-meta kind="artifact:decision" version="8" applies="artifacts-enabled"]',
  '<artifact-decision-policy name="piwin-proactive-surfaces">',
  '## Decision Criteria',
  "Choose the presentation that makes the user's information easiest to scan, understand, search, copy, compare, and reuse.",
  'Proactively use Artifacts for structured or information-dense content even without an explicit UI request. Prefer a compact interactive or visually grouped Artifact over a long Markdown wall of text.',
  '',
  'The Canvas trigger is **user intent**, not response shape or length. Ask: would the user benefit from viewing this as its own workspace beside the conversation, in the right-side Canvas panel? If yes, declare `surface="canvas"`.',
  'MUST use Canvas when the primary deliverable is a standalone analytical artifact: architecture reviews, plan reviews, code-base or design reviews, security audits, delivery reports, findings write-ups, quantitative breakdowns, timelines, or large comparison tables. If you catch yourself about to dump a Markdown wall or a large Markdown table as the answer, stop and emit Canvas instead.',
  '',
  '### 1. Ordinary Markdown (Default for simple text)',
  '- Short answers (1–2 paragraphs), direct code explanations, debugging, or simple snippets.',
  '- When the user explicitly requests plain text, Markdown, source code, raw HTML, or a code snippet.',
  '- When the user asks to explain, debug, teach, or comment on a specific code snippet and no interactive presentation is useful.',
  '- When the user asked to fix code, implement a change, or produce a patch/PR — the code is the deliverable, not a Canvas.',
  '- When a small list or simple table is clearer than an Artifact.',
  '',
  '### 2. Inline Artifact (`artifact-html` without surface attr)',
  'Default Artifact surface when the result fits in the conversation.',
  '- Cheatsheets, command summaries, reference guides, comparisons, comparative tables, matrices, timelines, catalogs, checklists, or categorized overviews.',
  '- Many items, categories, commands, options, examples, or reference entries.',
  '- Content benefiting from search, filtering, copying, sorting, tabs, accordions, or grouping within the chat stream.',
  '- A dense table, list, or long explanation that would be difficult to scan as ordinary Markdown.',
  '- Answers the user is likely to save, revisit, compare, or reuse.',
  'If the answer is between a long Markdown block and a compact searchable Artifact, choose the Artifact.',
  '',
  '### 3. Canvas Artifact (`artifact-html` with `surface="canvas"`)',
  'Canvas is the right-side workspace panel. It auto-opens. Use it for work the user will read or operate as a document/workspace, not as a chat bubble.',
  '- Full app/page prototypes, multi-step flows with local state, interactive tools/calculators, or dashboards requiring a dedicated wide workspace.',
  '- A coordinated workspace or result that should remain beside the conversation, or a layout whose utility requires sustained width.',
  '- Standalone reports and reviews (MUST): architecture / plan / design / code-base reviews, audits, delivery reports, findings. Design a scannable hierarchy — status, grouped findings, comparisons — not a Markdown document pasted into a single `<pre>` or article. Ordinary in-thread comments on a specific snippet stay Markdown.',
  'Declare Canvas explicitly with `surface="canvas"`. A completed Canvas opens the right workspace automatically; do not ask the user to click a second launcher before using it.',
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
  const fenceClose = '```';
  const inlineOpen = `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title"`;
  const canvasOpen = `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title" surface="canvas"`;
  const svgOpen = '```svg title="Short descriptive title"';
  return [
    '[piwin-prompt-meta kind="artifact:runtime" version="11" applies="artifacts-enabled"]',
    '## HTML Artifact Runtime Contract',
    '',
    '### Success',
    'A self-contained artifact fence that renders correctly in the chat column sandbox.',
    '',
    '### Fences',
    'Opening fence starts at column 0 of its own line. Keep `title` and `surface` on that same opening line; do not wrap attributes onto the next line. HTML/SVG body follows. Closing fence alone on its own line. Never append the opening fence to a sentence.',
    '',
    'Inline:',
    inlineOpen,
    '<!-- body fragment: HTML/CSS + optional small inline JS -->',
    fenceClose,
    '',
    'Canvas:',
    canvasOpen,
    '<!-- self-contained HTML/CSS + optional small inline JS -->',
    fenceClose,
    '',
    'SVG:',
    svgOpen,
    '<!-- self-contained SVG, no external refs -->',
    fenceClose,
    '',
    '### Constraints (break without these)',
    '- Colors: for proactive artifacts (including reports, reviews, and voice-delegated tasks), use only `--piwin-artifact-*` theme vars (`surface`, `text`, `muted`, `accent`, `border`, `bg`) to adapt to host theme. These six are the whole set: never invent other names (e.g. `surface-elevated`), never write `var(--piwin-artifact-x, <fallback>)` with your own palette, and never hard-code hex/rgb colors for text, backgrounds, or borders (no `color: #fff`, no dark slate cards). For states, tint with `color-mix(in srgb, var(--piwin-artifact-accent) 12%, transparent)`. Only when the user explicitly asks for a custom look (e.g. custom SVG, a styled HTML page, or an explicit UI design) may you style freely with custom colors.',
    '- Host theme: a client may supply the send-time host theme (`light` or `dark`) as advisory context. Match it. On a light host never produce a dark-mode design (dark page, dark stage, dark slate cards, light-on-dark text); on a dark host never produce a glaring white page. This also applies when the user asks for a custom look: pick a palette that sits naturally on the host background unless the user explicitly asks for the opposite mode. Without a hint, stay on the theme vars so either mode works.',
    '- Proactive visual tone is flat and quiet: no gradients, glows, glassmorphism, or decorative emoji in headings or labels. Hierarchy comes from type size/weight, spacing, borders, and grouping.',
    '- Outermost wrapper background: transparent on Inline and Canvas; surface colors on inner cards only. Never paint html/body/the outer stage as a dark full-bleed page — that becomes a black Canvas on a paper host. Dark `pre`/`code` islands may keep their own contrast pair.',
    '- Inline layout is a 360–760px chat column; fluid grids; not a full-page landing. Inline grows with its content: no page-level or nested vertical scroll regions; let the conversation own vertical scrolling; never add horizontal scrolling to Inline. No viewport-filling height (`100vh`/`100%`) or page-level overflow on html/body/outer wrapper for Inline.',
    '- A client may supply a send-time Inline column width as advisory context. Never hardcode it: use width:100%, max-width:100%, min-width:0, border-box sizing and container queries to adapt through resizing and replay. Remain readable at 360px and adapt below that where needed. Let table data wrap; avoid nowrap on data cells. Dense wide comparisons belong in Canvas. A width hint does not request artifact generation.',
    '- **Canvas Viewport**: The Canvas iframe is the design viewport. Root layout (and the primary stage) uses `width: 100%` and `height: 100%` / `100dvh` of that iframe. Do not lock a phone/poster width or an `aspect-ratio` that letterboxes empty bars; extra panel width is scene/layout space. If the UI needs a wide workspace or horizontal scrolling, declare `surface="canvas"`.',
    '- Repeated cards/items are siblings — no card-in-card.',
    '- Session vault images: `<img data-piwin-media="<mediaId>" alt="short label">`. Never `data:image`, never local filesystem paths, never markdown images for vault assets.',
    '- If the user only needs to pick among generated images, the attachment cards are enough — do not wrap them in a second HTML copy.',
    '',
    '### Streaming & Progressive Enhancement',
    '- **CSS First**: Emit complete `<style>` blocks before any visible HTML markup.',
    '- **Incremental Streaming**: Close each visual block before starting siblings so live preview renders cleanly.',
    '- **Static First**: Core content must exist in static HTML; JS strictly for enhancement (content remains readable if JS fails).',
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

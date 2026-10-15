/**
 * Artifact constants, configuration types, and model-facing protocol
 * shared across packages. Renderer runtime lives in @piwin/artifact.
 */

import { formatArtifactComponentKit, formatArtifactComponentKitReference } from './artifact-component-kit.js';
import { formatArtifactDiagramKit, formatArtifactDiagramKitReference } from './artifact-diagram-kit.js';
import { formatArtifactReportKit } from './artifact-report-kit.js';

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
/**
 * Session scope key for the per-scope Artifact switches. Mirrors
 * `SessionScope.kind` so Host compilation and Desktop rendering classify a
 * session exactly the same way:
 *
 * - `general` — Conversation chat (素笺 / No Repo), a general-scope session.
 * - `project` — Agent chat, a session inside a project folder.
 */
export type ArtifactScopeKey = 'general' | 'project';

/** Per-surface switches inside one scope. */
export type ArtifactSurfaceSwitches = {
  /** Inline Artifacts rendered in the chat column. */
  inline: boolean;
  /** Right-side Canvas Artifacts. */
  canvas: boolean;
};

/** Per-scope surface switches. A missing entry keeps every surface on. */
export type ArtifactScopesConfig = Record<ArtifactScopeKey, ArtifactSurfaceSwitches>;

/**
 * Effective Artifact capability for one session/generation: the master switch
 * intersected with the session's scope switches. `enabled` is false when the
 * master switch is off or when the scope has no surface left.
 */
export type ResolvedArtifactCapability = {
  enabled: boolean;
  inline: boolean;
  canvas: boolean;
};

/** No Artifact surface at all. */
export const DISABLED_ARTIFACT_CAPABILITY: ResolvedArtifactCapability = {
  enabled: false,
  inline: false,
  canvas: false,
};

/** Every surface on — the shipped default and the isolated-caller fallback. */
export const FULL_ARTIFACT_CAPABILITY: ResolvedArtifactCapability = {
  enabled: true,
  inline: true,
  canvas: true,
};

export type ArtifactConfig = {
  /** Master switch. When false, no artifact prompt is injected and the heavy path is disabled. */
  enabled: boolean;
  /**
   * Per-scope surface switches below the master switch. Optional so older
   * `config.json` files keep working: a missing scope or surface means "on".
   */
  scopes?: ArtifactScopesConfig;
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
  /**
   * Internal switch, not in Settings. `model` (default) lets the model pick
   * `style="expressive"`; `host-only` renders everything under host style.
   */
  styleModes?: ArtifactStyleModes;
};

export type ArtifactStyleModes = 'model' | 'host-only';

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

/**
 * Renderer generation a shell advertises on `PromptInput.artifactKit`.
 * 1 = renders runtime contract v14 (extended tokens, `style`, built-in kit).
 */
export const ARTIFACT_KIT_VERSION = 1 as const;

/** Kit v1 icon names; `@piwin/artifact` draws exactly this set (checked by test). */
export const ARTIFACT_KIT_V1_ICONS = ['activity', 'alert', 'arrow-down', 'arrow-left', 'arrow-right', 'arrow-up', 'book', 'bookmark', 'brain', 'bug', 'calendar', 'chart', 'check', 'check-circle', 'clock', 'cloud', 'code', 'coffee', 'database', 'doc', 'download', 'external', 'eye', 'file', 'flame', 'folder', 'fork', 'git', 'globe', 'heart', 'image', 'info', 'leaf', 'link', 'lock', 'minus', 'moon', 'pause', 'pin', 'play', 'plus', 'refresh', 'search', 'server', 'settings', 'shield', 'star', 'sun', 'table', 'target', 'terminal', 'trend-down', 'trend-up', 'user', 'users', 'warn', 'x', 'x-circle', 'zap'] as const;

/**
 * Kit reference returned by `artifact_instructions` (not resident: the
 * resident contract only carries the one-line pointer).
 */
export function formatArtifactKitReference(): string {
  return [
    '[piwin-artifact-kit version="1"]',
    'Local built-ins, no network. Use only when they help; plain HTML/SVG stays fine.',
    `Icons: \`<i data-piwin-icon="NAME" data-size="16"></i>\` (stroke = currentColor; size 8–96). Names: ${ARTIFACT_KIT_V1_ICONS.join(' ')}.`,
    'Charts: `<figure data-piwin-chart="bar|hbar|line|donut|stack|spark">` holding `<script type="application/json">` with {"labels": [..], "series": [{"name": "..", "values": [..], "tone": "ok"}], "tones": [..], "unit": "ms", "min": n, "max": n, "height": px, "values": true, "area": true, "center": "96%", "centerLabel": "passed"}. Always add a `<figcaption>` that states the takeaway in words; it stays readable if the chart cannot draw.',
    '- bar: grouped bars per label on a value axis; values print above the bars when there are few. hbar: one row per label with the label on the left and the value on the right — the choice for rankings and long category names. line: one line per series; a single series gets a soft area fill and its latest value. donut: first series as parts of `labels`, legend with shares beside it, optional `center` / `centerLabel`. stack: one bar split into the shares of `labels`, for composition in a single row. spark: tiny inline trend.',
    '- `unit` is appended to values and ticks; `min`/`max` fix the axis; `values` forces value labels on or off; `area` fills under every line.',
    '- Colors: status data says so with `tone` (ok=green, warn=amber, risk=red, info=blue; also accent, accent-2, muted): pass/fail, success/error, blocked, flaky. Donut slices take `tones` in label order. Series and slices named like 成功/通过/失败/阻塞/建议 (success/pass/fail/blocked/warning) get that tone automatically. Neutral data omits tone and uses `series-1`…`series-6` in order (blue first; status hues last). `color` accepts only `var(--piwin-artifact-*)`. Charts redraw with the container width.',
    'Script API for interactive artifacts: `piwin.chart(el, {kind, labels, series, height})`, `piwin.icon(name, size)` → SVG string, `piwin.hydrate(root)` after inserting kit markup, `piwin.version`.',
    ...formatArtifactDiagramKitReference(),
    ...formatArtifactComponentKitReference(),
    '[/piwin-artifact-kit]',
  ].join('\n');
}

/** Trigger constraint prefixed onto instructions whenever triggerMode is explicit-only. */
/** Prefixed onto instructions when `artifact.styleModes` is `host-only`. */
export const ARTIFACT_HOST_STYLE_ONLY_HINT =
  'Expressive style is off for this Host: every artifact fence uses `style="host"`.';

export const ARTIFACT_EXPLICIT_ONLY_HINT =
  'Use an Artifact only when the user explicitly requests an artifact, visualization, interactive page, prototype, or UI.';

/**
 * Surface constraint prefixed onto instructions when the session's scope keeps
 * only the Inline surface. Like {@link ARTIFACT_EXPLICIT_ONLY_HINT} this is a
 * product constraint, not part of the editable decision prompt.
 */
export const ARTIFACT_INLINE_ONLY_HINT =
  'Artifact surfaces for this session: Inline only (the right-side Canvas panel is unavailable). Every artifact is an Inline `artifact-html`/`svg` fence without a `surface` attribute, and the Canvas rules in the decision policy are inactive. Use Inline when a visualization helps, otherwise answer in Markdown.';

/**
 * Surface constraint prefixed onto instructions when the session's scope keeps
 * only the Canvas surface.
 */
export const ARTIFACT_CANVAS_ONLY_HINT =
  'Artifact surfaces for this session: Canvas only (the chat-column Artifact preview is unavailable). Every artifact declares `surface="canvas"`: standalone deliverables go there, and everything else stays ordinary Markdown.';

/**
 * Shipped per-scope surface switches.
 *
 * Conversation chat renders Artifacts by default. Agent chat (a project folder
 * session) ships with **Canvas only**: a coding transcript stays Markdown and
 * source, while a standalone deliverable (a report, a prototype) can open in
 * the side workspace instead of flooding the chat column.
 */
export function createDefaultArtifactScopes(): ArtifactScopesConfig {
  return {
    general: { inline: true, canvas: true },
    project: { inline: false, canvas: true },
  };
}

/**
 * Resolve the master switch and the per-scope switches into the capability a
 * generation or a transcript render actually gets.
 *
 * `undefined` config means "Host config not loaded yet" and keeps the shipped
 * default scopes, which is also what isolated callers rely on.
 *
 * A missing scope or surface follows {@link createDefaultArtifactScopes} rather
 * than "on", so a config written before `scopes` existed adopts the shipped
 * default and an explicit `true` is what opts a surface back in.
 */
export function resolveArtifactCapability(
  config: ArtifactConfig | undefined,
  scopeKey: ArtifactScopeKey,
): ResolvedArtifactCapability {
  const artifact = config ?? createDefaultArtifactConfig();
  if (!artifact.enabled) {
    return { ...DISABLED_ARTIFACT_CAPABILITY };
  }
  const scopeDefaults = createDefaultArtifactScopes()[scopeKey];
  const scope = artifact.scopes?.[scopeKey];
  const inline = scope?.inline ?? scopeDefaults.inline;
  const canvas = scope?.canvas ?? scopeDefaults.canvas;
  if (!inline && !canvas) {
    return { ...DISABLED_ARTIFACT_CAPABILITY };
  }
  return { enabled: true, inline, canvas };
}

/**
 * Constraint line describing a surface-restricted capability. Undefined when
 * both surfaces are available (nothing to override) or when nothing is
 * enabled (the instructions must not be injected at all).
 */
export function resolveArtifactSurfaceHint(
  capability: ResolvedArtifactCapability,
): string | undefined {
  if (!capability.enabled) {
    return undefined;
  }
  if (capability.inline && capability.canvas) {
    return undefined;
  }
  return capability.inline ? ARTIFACT_INLINE_ONLY_HINT : ARTIFACT_CANVAS_ONLY_HINT;
}

export function createDefaultArtifactConfig(): ArtifactConfig {
  return {
    enabled: true,
    scopes: createDefaultArtifactScopes(),
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
  '[piwin-prompt-meta kind="artifact:decision" version="13" applies="artifacts-enabled"]',
  '<artifact-decision-policy name="piwin-proactive-surfaces">',
  '## Decision Criteria',
  'Choose the presentation that lets the reader scan, understand, search, copy, compare, and reuse the information.',
  'Use an Artifact for structured or information-dense content even without an explicit UI request: compact, grouped or interactive content reads better than a Markdown wall of text.',
  '',
  'You choose the form, and the content decides it: a flow for steps, a swimlane for handoffs between actors, a timeline for dated events, a tree for hierarchy, a matrix for items × attributes, a chart for quantities, an SVG diagram or a layout of your own for everything else. Cards suit a few parallel, independent items. Mix forms freely in one artifact; a form that matches the content is what makes it clear at a glance.',
  '',
  'Choose the surface by **user intent**, not response length. Canvas (`surface="canvas"`) is a workspace beside the conversation, and a standalone analytical deliverable belongs there: architecture reviews, plan reviews, code-base or design reviews, security audits, delivery reports, findings write-ups, quantitative breakdowns, timelines, large comparison tables. When an answer is heading toward a long Markdown document or a large Markdown table, make it a Canvas.',
  'Unprompted artifacts use `style="host"`.',
  '',
  '### 1. Ordinary Markdown (default for simple text)',
  '- Short answers (1–2 paragraphs), direct code explanations, debugging, or simple snippets.',
  '- The user asks for plain text, Markdown, source code, raw HTML, or a code snippet.',
  '- The user asks to explain, debug, teach, or comment on a specific code snippet and a plain reply serves them.',
  '- The user asks to fix code, implement a change, or produce a patch/PR: the code is the deliverable.',
  '- A small list or simple table is clearer than an Artifact.',
  '',
  '### 2. Inline Artifact (`artifact-html` without surface attr)',
  'Default Artifact surface when the result fits in the conversation.',
  '- Cheatsheets, command summaries, reference guides, comparisons, comparative tables, matrices, timelines, catalogs, checklists, categorized overviews.',
  '- Many items, or content that benefits from search, filtering, copying, sorting, tabs, accordions, or grouping.',
  '- Dense content that is hard to scan in Markdown; answers users will save, revisit, compare, or reuse.',
  'When the answer sits between a long Markdown block and a compact searchable Artifact, choose the Artifact.',
  '',
  '### 3. Canvas Artifact (`artifact-html` with `surface="canvas"`)',
  'Canvas is the right-side workspace panel. Use it for work the user reads or operates as a document or workspace.',
  '- Full app/page prototypes, multi-step flows with local state, interactive tools/calculators, dashboards that need a wide workspace.',
  '- A coordinated workspace or result that stays beside the conversation, or a layout that needs sustained width.',
  '- Standalone reports and reviews: architecture / plan / design / code-base reviews, audits, delivery reports, findings. Give them a scannable hierarchy — status, grouped findings, comparisons, diagrams. The Report Kit is the quickest route. Ordinary in-thread comments on a specific snippet stay Markdown.',
  '- Content already written to a file this turn: the Canvas shows what the text cannot at a glance — conclusions, status, key comparisons — and points to the file for the full text.',
  'Declaring `surface="canvas"` is all it takes: it opens the right workspace automatically.',
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
  const inlineOpen = `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title" style="host"`;
  const canvasOpen = `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title" surface="canvas" style="host"`;
  const svgOpen = '```svg title="Short descriptive title" style="host"';
  return [
    '[piwin-prompt-meta kind="artifact:runtime" version="15" applies="artifacts-enabled"]',
    '## HTML Artifact Runtime Contract',
    '',
    '### Success',
    'A self-contained artifact fence that renders correctly in the chat column sandbox.',
    '',
    '### Fences',
    'The opening fence starts at column 0 of its own line and carries `title`, `surface` and `style` together on that one line. The HTML/SVG body follows. The closing fence sits alone on its own line. Put a line break between a sentence and the opening fence, because the parser only recognizes a fence that begins a line. An artifact is always a Markdown code fence; XML-style wrapper tags are not an artifact format.',
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
    '<!-- self-contained SVG, all assets inline -->',
    fenceClose,
    '',
    '### Rendering rules (the sandbox depends on these)',
    '- Style: every fence declares `style="host"`. `style="expressive"` is for when the user asks for a look, prototype, game, or poster; reports and unprompted artifacts use `host`.',
    '- Colors: take every color from the `--piwin-artifact-*` vars, so the artifact follows the host theme in light and dark: `bg surface surface-2 text muted subtle accent accent-2 on-accent border border-strong`, status `ok warn info risk` (`risk` marks real problems), charts `series-1`…`series-6`. This list is the complete set. Literal hex/rgb belongs to expressive illustrations. Text uses `text`/`muted`/`subtle`/status, or `on-accent` on a solid fill; `bg` and `surface*` are backgrounds. Tint: `color-mix(in srgb, var(--piwin-artifact-<c>) 12%, transparent)`. Floating layers (sticky bar, toast, popover) use `surface`.',
    '- Inline code & tokens: neutral `color-mix(in srgb, var(--piwin-artifact-text) 8%, transparent)` background with `var(--piwin-artifact-text)` text; red tones are reserved for errors and diff deletions. Badges: muted for inactive/hidden, accent for ready/visible, amber for estimate/progress.',
    '- Host theme: follow the send-time `light`/`dark` hint in every style, expressive stages and cards included: a light host gets a light design and a dark host a dark one, unless the user asks for the opposite mode. Without a hint, theme vars cover both modes.',
    '- Host tone: quiet with depth: `shadow-1` on cards, `shadow-2` on floating layers, `radius-sm`/`radius-lg`; title hierarchy by size and weight in `--piwin-artifact-font`, the host font throughout; one hero may use a theme-var gradient; surfaces are solid and matte; labels are plain text.',
    '- Expressive: an inner stage may paint gradients, illustration, motion, large type; the outer page stays transparent; text keeps 4.5:1 and reads on light and dark hosts.',
    '- Outermost wrapper background: transparent on Inline and Canvas, because the host page shows through it; `surface` goes on inner cards. `pre`/`code` islands may keep their own dark contrast pair.',
    '- Inline layout: a fluid 360–760px chat column, sized like a message in the thread. Inline grows with its content and the conversation owns scrolling in both directions: height stays auto on html/body/outer wrapper and every block fits the column width.',
    '- Inline width: `width:100%`, `max-width:100%`, `min-width:0`, border-box sizing and container queries for stacking, readable at 360px and below. The advisory width hint describes the sending client; replay and other clients differ.',
    '- Built-ins (no network): `data-piwin-icon` icons; `data-piwin-chart="bar|hbar|line|donut|stack|spark"` charts. Call `artifact_instructions` for the icon list and chart options.',
    formatArtifactDiagramKit(),
    formatArtifactComponentKit(),
    '- Tables: wrap long data cells with `overflow-wrap: break-word`, the one wrapping property that keeps column min-content intact (`word-break` values and `overflow-wrap: anywhere` collapse a column to 1ch). Row/column labels may `white-space: nowrap` or `width: max-content`. `min-width: 0` belongs on the outer stage. Inline: stack with `@container` before wrapping labels. Canvas: dense comparisons keep label min-content and may use table `overflow-x: auto`. Dense wide comparisons belong on Canvas.',
    '- **Canvas Viewport**: the Canvas iframe is the design viewport. Root layout and the primary stage use `width: 100%` and `height: 100%` / `100dvh` of it, and extra panel width becomes scene/layout space, so the design fills the panel edge to edge. A UI that needs a wide workspace or horizontal scrolling declares `surface="canvas"`.',
    '- Repeated cards/items are siblings in one flat list.',
    '- Flex and grid rows: each direct child is one cell, and so is each bare text run. Wrap a whole sentence — its text together with its inline `code`, `b` and `a` — in a single child element (`<span>` or `<p>`), so the sentence stays on one line of flow beside the marker or icon.',
    '- Session vault images: `<img data-piwin-media="<mediaId>" alt="short label">` is the way to show them; the host resolves the id to the image.',
    '- When the user only needs to pick among generated images, the attachment cards already do that job.',
    '',
    ...formatArtifactReportKit(),
    '',
    '### Streaming & Progressive Enhancement',
    '- **CSS First**: when you write a `<style>` block, emit it complete before any visible HTML markup, so the preview has its styles from the first element.',
    '- **Incremental Streaming**: Close each visual block before starting siblings so live preview renders cleanly.',
    '- **Static First**: core content lives in static HTML and JS enhances it, so the content stays readable if JS fails.',
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
 * prompt, so it is prefixed whenever `triggerMode === 'explicit-only'`. The
 * same pattern carries a surface restriction (`capability`): the shared
 * decision policy and runtime protocol stay byte-identical, and the prefix
 * states which surfaces this session actually has.
 *
 * Returns an empty string when the capability is disabled — callers must not
 * inject instructions for a session with no Artifact surface.
 */
export function formatArtifactInstructions(
  config: ArtifactConfig,
  capability: ResolvedArtifactCapability = FULL_ARTIFACT_CAPABILITY,
): string {
  if (!capability.enabled) {
    return '';
  }
  const parts = [
    config.triggerMode === 'explicit-only' ? ARTIFACT_EXPLICIT_ONLY_HINT : undefined,
    config.styleModes === 'host-only' ? ARTIFACT_HOST_STYLE_ONLY_HINT : undefined,
    resolveArtifactSurfaceHint(capability),
    resolveArtifactDecisionPrompt(config),
    formatArtifactProtocol(),
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.join('\n\n');
}

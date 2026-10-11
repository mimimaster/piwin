/**
 * Artifact constants, configuration types, and model-facing protocol
 * shared across packages. Renderer runtime lives in @piwin/artifact.
 */

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
    'Charts: `<figure data-piwin-chart="bar|line|donut|spark">` holding `<script type="application/json">` with {"labels": [..], "series": [{"name": "..", "values": [..], "color": "var(--piwin-artifact-series-2)"}], "max": n, "height": px, "center": "96%"}. Always add a `<figcaption>` that states the takeaway in words; it stays readable if the chart cannot draw.',
    '- bar: grouped bars per label. line: one line per series. donut: first series as parts of `labels`, optional `center` text. spark: tiny inline trend, no labels.',
    '- Colors: omit for `series-1`…`series-6` in order; `color` accepts only `var(--piwin-artifact-*)`. Charts redraw with the container width.',
    'Script API for interactive artifacts: `piwin.chart(el, {kind, labels, series, height})`, `piwin.icon(name, size)` → SVG string, `piwin.hydrate(root)` after inserting kit markup, `piwin.version`.',
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
  'Artifact surfaces are restricted right now: Inline only. Never declare `surface="canvas"` and ignore the Canvas rules in the decision policy above — the right-side Canvas panel is unavailable for this session. Use an Inline `artifact-html`/`svg` fence when a visualization helps, otherwise answer in Markdown.';

/**
 * Surface constraint prefixed onto instructions when the session's scope keeps
 * only the Canvas surface.
 */
export const ARTIFACT_CANVAS_ONLY_HINT =
  'Artifact surfaces are restricted right now: Canvas only. Never emit an Inline artifact fence — the chat-column Artifact preview is unavailable for this session. Standalone deliverables use `surface="canvas"`; anything that does not need the right-side workspace stays ordinary Markdown.';

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
  '[piwin-prompt-meta kind="artifact:decision" version="11" applies="artifacts-enabled"]',
  '<artifact-decision-policy name="piwin-proactive-surfaces">',
  '## Decision Criteria',
  "Choose the presentation that makes the user's information easiest to scan, understand, search, copy, compare, and reuse.",
  'Proactively use Artifacts for structured or information-dense content even without an explicit UI request. Prefer a compact interactive or visually grouped Artifact over a long Markdown wall of text.',
  '',
  'The Canvas trigger is **user intent**, not response shape or length. Ask: would the user benefit from viewing this as its own workspace beside the conversation, in the right-side Canvas panel? If yes, declare `surface="canvas"`.',
  'MUST use Canvas when the primary deliverable is a standalone analytical artifact: architecture reviews, plan reviews, code-base or design reviews, security audits, delivery reports, findings write-ups, quantitative breakdowns, timelines, or large comparison tables. If you catch yourself about to dump a Markdown wall or a large Markdown table as the answer, stop and emit Canvas instead.',
  'Unprompted artifacts use `style="host"`.',
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
  '- Standalone reports and reviews (MUST): architecture / plan / design / code-base reviews, audits, delivery reports, findings. Design a scannable hierarchy — status, grouped findings, comparisons — not a Markdown document pasted into a single `<pre>` or article. Use the Report Kit. Ordinary in-thread comments on a specific snippet stay Markdown.',
  '- Already written to a file this turn: do not repeat the file in a Canvas. A Canvas still earns its place when it shows what the text cannot at a glance — conclusions, status, key comparisons — and points to the file for the full text.',
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
  const inlineOpen = `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title" style="host"`;
  const canvasOpen = `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title" surface="canvas" style="host"`;
  const svgOpen = '```svg title="Short descriptive title" style="host"';
  return [
    '[piwin-prompt-meta kind="artifact:runtime" version="14" applies="artifacts-enabled"]',
    '## HTML Artifact Runtime Contract',
    '',
    '### Success',
    'A self-contained artifact fence that renders correctly in the chat column sandbox.',
    '',
    '### Fences',
    'Opening fence starts at column 0 of its own line. Keep `title`, `surface` and `style` on that same opening line; do not wrap attributes onto the next line. HTML/SVG body follows. Closing fence alone on its own line. Never append the opening fence to a sentence.',
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
    '- Style: every fence declares `style="host"`, or `style="expressive"` only when the user asks for a look, prototype, game, or poster. Reports and anything shown unprompted stay `host`.',
    '- Colors: only `--piwin-artifact-*` vars: `bg surface surface-2 text muted subtle accent accent-2 on-accent border border-strong`, status `ok warn info risk` (`risk` = real problems), charts `series-1`…`series-6`. Never invent names or add fallback palettes; no hex/rgb for text, backgrounds or borders outside expressive illustrations. Text: `text`/`muted`/`subtle`/status, or `on-accent` on a solid fill; never `bg`/`surface*`. Tint: `color-mix(in srgb, var(--piwin-artifact-<c>) 12%, transparent)`. Floating layers (sticky bar, toast, popover) use `surface`.',
    '- Inline code & tokens: inline `<code>` and technical identifiers must use a neutral translucent background `color-mix(in srgb, var(--piwin-artifact-text) 8%, transparent)` with text `var(--piwin-artifact-text)`. Never use reddish, maroon, or brownish backgrounds for code tokens (red is strictly reserved for errors/diff deletions). Badges use muted neutral for inactive/hidden, accent for ready/visible, amber for estimate/progress.',
    '- Host theme: a client may supply the send-time host theme (`light` or `dark`) as advisory context. Match it. On a light host never produce a dark-mode design (dark page, dark stage, dark slate cards, light-on-dark text); on a dark host never produce a glaring white page. This also applies when the user asks for a custom look: pick a palette that sits naturally on the host background unless the user explicitly asks for the opposite mode. Without a hint, stay on the theme vars so either mode works.',
    '- Host tone: quiet, not flat: `shadow-1` on cards, `shadow-2` on floating layers, `radius-sm`/`radius-lg`; title hierarchy by size and weight in `--piwin-artifact-font` (no serif or display fonts); one hero may use a theme-var gradient; no glows, glass, neon, or emoji in labels.',
    '- Expressive: an inner stage may paint gradients, illustration, motion, large type; the outer page stays transparent; text keeps 4.5:1 and reads on light and dark hosts.',
    '- Outermost wrapper background: transparent on Inline and Canvas; surface colors on inner cards only. Never paint html/body/the outer stage as a dark full-bleed page — that becomes a black Canvas on a paper host. Dark `pre`/`code` islands may keep their own contrast pair.',
    '- Inline layout is a 360–760px chat column; fluid grids; not a full-page landing. Inline grows with its content: no page-level or nested vertical scroll regions; let the conversation own vertical scrolling; never add horizontal scrolling to Inline. No viewport-filling height (`100vh`/`100%`) or page-level overflow on html/body/outer wrapper for Inline.',
    '- A client may supply a send-time Inline column width as advisory context. Never hardcode it: use width:100%, max-width:100%, min-width:0, border-box sizing and container queries to adapt through resizing and replay. Remain readable at 360px and adapt below that where needed. A width hint does not request artifact generation.',
    '- Built-ins (no network): `<i data-piwin-icon="check"></i>` icons and `<figure data-piwin-chart="bar|line|donut|spark"><script type="application/json">{"labels":[],"series":[{"name":"","values":[]}]}</script><figcaption>…</figcaption></figure>` charts. Call `artifact_instructions` for the icon list and chart options.',
    '- Tables: wrap long data cells with `overflow-wrap: break-word` only. Never `word-break: break-word`, `word-break: break-all`, or `overflow-wrap: anywhere` — they collapse column min-content to 1ch. Row/column labels may `white-space: nowrap` or `width: max-content`. `min-width: 0` is for the outer stage, not table columns. Inline: no page-level horizontal scroll; stack with `@container` before wrapping labels. Canvas: dense comparisons keep label min-content; table `overflow-x: auto` is allowed. Dense wide comparisons belong on Canvas.',
    '- **Canvas Viewport**: The Canvas iframe is the design viewport. Root layout (and the primary stage) uses `width: 100%` and `height: 100%` / `100dvh` of that iframe. Do not lock a phone/poster width or an `aspect-ratio` that letterboxes empty bars; extra panel width is scene/layout space. If the UI needs a wide workspace or horizontal scrolling, declare `surface="canvas"`.',
    '- Repeated cards/items are siblings — no card-in-card.',
    '- Session vault images: `<img data-piwin-media="<mediaId>" alt="short label">`. Never `data:image`, never local filesystem paths, never markdown images for vault assets.',
    '- If the user only needs to pick among generated images, the attachment cards are enough — do not wrap them in a second HTML copy.',
    '',
    ...formatArtifactReportKit(),
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

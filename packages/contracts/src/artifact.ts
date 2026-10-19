/**
 * Artifact constants, configuration types, and model-facing protocol
 * shared across packages. Renderer runtime lives in @piwin/artifact.
 */

import { formatArtifactComponentKitReference } from './artifact-component-kit.js';
import { formatArtifactDiagramKitReference } from './artifact-diagram-kit.js';
import { formatArtifactRenderingReference } from './artifact-rendering-reference.js';
import { formatArtifactVizKitReference } from './artifact-viz-kit.js';

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

/** Host tool that returns detailed authoring and built-in kit references on demand. */
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
    ...formatArtifactRenderingReference(),
    `Icons: \`<i data-piwin-icon="NAME" data-size="16"></i>\` (stroke = currentColor; size 8–96). Names: ${ARTIFACT_KIT_V1_ICONS.join(' ')}.`,
    'Charts: `<figure data-piwin-chart="bar|hbar|line|donut|stack|spark">` holding `<script type="application/json">` with {"labels": [..], "series": [{"name": "..", "values": [..], "tone": "ok"}], "tones": [..], "unit": "ms", "min": n, "max": n, "height": px, "values": true, "area": true, "center": "96%", "centerLabel": "passed"}. Always add a `<figcaption>` that states the takeaway in words; it stays readable if the chart cannot draw.',
    '- bar: grouped bars per label on a value axis; values print above the bars when there are few. hbar: one row per label with the label on the left and the value on the right — the choice for rankings and long category names. line: one line per series; a single series gets a soft area fill and its latest value. donut: first series as parts of `labels`, legend with shares beside it, optional `center` / `centerLabel`. stack: one bar split into the shares of `labels`, for composition in a single row. spark: tiny inline trend.',
    '- `unit` is appended to values and ticks; `min`/`max` fix the axis; `values` forces value labels on or off; `area` fills under every line.',
    '- line extras: `refs` [{"y": 16, "from": 0, "to": 12, "label": "ssthresh"}] draws dashed threshold segments; `marks` [{"at": 12, "label": "超时", "tone": "risk"}] labels a point of the first series.',
    '- Colors: status data says so with `tone` (ok=green, warn=amber, risk=red, info=blue; also accent, accent-2, muted): pass/fail, success/error, blocked, flaky. Donut slices take `tones` in label order. Series and slices named like 成功/通过/失败/阻塞/建议 (success/pass/fail/blocked/warning) get that tone automatically. Neutral data omits tone and uses `series-1`…`series-6` in order (blue first; status hues last). `color` accepts only `var(--piwin-artifact-*)`. Charts redraw with the container width.',
    'Script API for interactive artifacts: `piwin.chart(el, {kind, labels, series, height})`, `piwin.icon(name, size)` → SVG string, `piwin.hydrate(root)` after inserting kit markup, `piwin.version`.',
    ...formatArtifactDiagramKitReference(),
    ...formatArtifactVizKitReference(),
    ...formatArtifactComponentKitReference(),
    '[/piwin-artifact-kit]',
  ].join('\n');
}

/** Trigger constraint prefixed onto instructions whenever triggerMode is explicit-only. */
/** Prefixed onto instructions when `artifact.styleModes` is `host-only`. */
export const ARTIFACT_HOST_STYLE_ONLY_HINT =
  'Only `style="host"` is available.';

export const ARTIFACT_EXPLICIT_ONLY_HINT =
  'Use Artifacts only when explicitly requested (artifact, visualization, interactive page, prototype or UI); otherwise use Markdown.';

/**
 * Surface constraint prefixed onto instructions when the session's scope keeps
 * only the Inline surface. Like {@link ARTIFACT_EXPLICIT_ONLY_HINT} this is a
 * product constraint, not part of the editable decision prompt.
 */
export const ARTIFACT_INLINE_ONLY_HINT =
  'Inline only: omit `surface`; Canvas is unavailable. Ignore Canvas routing below.';

/**
 * Surface constraint prefixed onto instructions when the session's scope keeps
 * only the Canvas surface.
 */
export const ARTIFACT_CANVAS_ONLY_HINT =
  'Canvas only: declare `surface="canvas"` for standalone deliverables; otherwise use Markdown.';

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
  '## Decision Criteria',
  'Use Markdown for short answers, code explanations, debugging, patches or requested source.',
  'Use Artifacts proactively when a diagram, structured comparison or interaction helps.',
  'Inline: content read in the conversation. Canvas: standalone reports, reviews, audits, prototypes or tools. Choose by user intent, not length.',
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
  const fence = '```';
  return [
    '## HTML Artifact Runtime Contract',
    'Artifacts use Markdown code fences, never XML wrapper tags. Fence markers start on their own lines at column 0; opening attributes stay on that line. Keep prose outside.',
    'Inline (omit surface):',
    `${fence}${CANONICAL_ARTIFACT_LANGUAGE} title="Title" style="host"`,
    '<main class="piwin-report">...</main>',
    fence,
    'Canvas:',
    `${fence}${CANONICAL_ARTIFACT_LANGUAGE} title="Title" surface="canvas" style="host"`,
    '<main class="piwin-report">...</main>',
    fence,
    'SVG may use a `svg` fence with the same attributes.',
    '- Self-contained HTML/CSS/JS, no network. Core content in HTML; CSS before markup, JS for enhancement.',
    '- Default `style="host"`: semantic HTML in `piwin-report` gets host styling. Custom CSS uses `--piwin-artifact-*` vars; outer background stays transparent.',
    '- `style="expressive"` is for requested custom looks, prototypes or games; follow the host light/dark theme.',
    '- Inline: fluid width, auto height, no nested page scroll. Canvas fills its viewport.',
    '- Images: `<img data-piwin-media="ID" alt="description">`.',
    '- Call `artifact_instructions` only for theme/layout details, charts, diagrams, icons or JS APIs.',
  ].join('\n');
}

/**
 * Fixed artifact runtime contract injected alongside the configurable
 * decision prompt. Always produced by `formatArtifactProtocol`.
 */
export const ARTIFACT_RUNTIME_CONTRACT = formatArtifactProtocol();

/**
 * Resident Artifact instructions: configured decision policy plus the compact
 * runtime protocol. Prompt injection paths use this single formatter; the
 * optional authoring reference is delivered separately by the Host tool.
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

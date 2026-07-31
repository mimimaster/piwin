/** Artifact policy constants (ported from openwebui_m, renamed for piwin). */

export const ARTIFACT_LANGUAGE_ALIASES = [
  'artifact-html',
  'artifact_html',
  'ui-html',
  'ui_html',
  'html-artifact',
] as const;

/** Fence languages that need HTML-like source heuristics before promotion. */
export const AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES = ['artifact', 'artifact-'] as const;

export const NATIVE_HTML_ARTIFACT_LANGUAGES = ['html', 'htm'] as const;

export const NATIVE_SVG_ARTIFACT_LANGUAGES = ['svg'] as const;

export const DEFAULT_MAX_ARTIFACT_BYTES = 100 * 1024;

export const MIN_ARTIFACT_IFRAME_HEIGHT = 40;
export const INITIAL_ARTIFACT_IFRAME_HEIGHT = 80;
export const MAX_ARTIFACT_IFRAME_HEIGHT = 900;
/** User-expanded max height for tall dashboards (D-ART-06). */
export const MAX_ARTIFACT_EXPANDED_HEIGHT = 2200;
export const ARTIFACT_READY_TIMEOUT_MS = 5000;

/** Max concurrent historical artifact iframe inits (srcdoc assignment). */
export const MAX_CONCURRENT_ARTIFACT_INITS = 1;

/** Confirm shrink after interaction before applying a smaller height. */
export const ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS = 70;

/**
 * Settle window after ready during which measured heights may shrink back to
 * the real content height (final-trim). Afterwards the height locks and only
 * grows again. Matches openwebui_m ARTIFACT_FINAL_TRIM_SETTLE_MS.
 */
export const ARTIFACT_FINAL_TRIM_SETTLE_MS = 900;

/** Re-measure ladder after ready (ms). */
export const ARTIFACT_HEIGHT_MEASURE_LADDER_MS = [0, 80, 180, 360, 720, 1200] as const;

/** postMessage types from sandboxed artifact iframe → parent. */
export const ARTIFACT_BRIDGE_READY_TYPE = 'piwin-artifact:ready' as const;
export const ARTIFACT_BRIDGE_RESIZE_TYPE = 'piwin-artifact:resize' as const;
/** User-intent actions from artifact UI → product (strict whitelist). */
export const ARTIFACT_BRIDGE_ACTION_TYPE = 'piwin-artifact:action' as const;

/**
 * Allowed artifact action names. Extend deliberately — every entry is a
 * capability the sandboxed (untrusted) HTML can invoke on the product.
 */
export const ARTIFACT_ACTION_NAMES = ['flashcard/rate', 'flashcard/open-source'] as const;

/** YouTube / Maps embeds allowed under default allowlist mode. */
export const DEFAULT_ARTIFACT_IFRAME_ALLOWED_URL_PREFIXES = [
  'https://www.youtube.com/embed/',
  'https://www.youtube-nocookie.com/embed/',
  'https://www.google.com/maps/',
  'https://maps.google.com/',
] as const;

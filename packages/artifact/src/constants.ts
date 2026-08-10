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
/** @deprecated Legacy scrollport cap; Inline now uses MAX_ARTIFACT_INLINE_FLOW_HEIGHT. */
export const MAX_ARTIFACT_IFRAME_HEIGHT = 900;
/** @deprecated Legacy expanded scrollport cap retained for API compatibility. */
export const MAX_ARTIFACT_EXPANDED_HEIGHT = 2200;
/**
 * Defensive ceiling for an Inline Artifact that flows with the transcript.
 * Inline no longer owns a 900px scrollport, but model HTML is untrusted and
 * must not be able to request an effectively unbounded iframe height.
 */
export const MAX_ARTIFACT_INLINE_FLOW_HEIGHT = 16_384;
export const ARTIFACT_READY_TIMEOUT_MS = 5000;

/** Max concurrent historical artifact iframe inits (srcdoc assignment). */
export const MAX_CONCURRENT_ARTIFACT_INITS = 1;

/**
 * Inline Artifact iframe viewport recycle: after leaving the transcript
 * viewport for this long, drop srcdoc/iframe to free WebContent memory.
 * Re-enter remounts via the init queue. Canvas presentation never recycles.
 * Combined with MAX_LIVE_ARTIFACT_IFRAMES (live-host-registry) for a hard cap.
 */
export const ARTIFACT_VIEWPORT_RECYCLE_TTL_MS = 5_000;

/** Priority bands for the live-host registry (higher = keep). */
export const ARTIFACT_LIVE_PRIORITY_OFFSCREEN = 10;
export const ARTIFACT_LIVE_PRIORITY_NEAR = 50;
export const ARTIFACT_LIVE_PRIORITY_VISIBLE = 100;
export const ARTIFACT_LIVE_PRIORITY_STREAM = 1_000;
export const ARTIFACT_LIVE_PRIORITY_CANVAS = 1_000;

/**
 * IntersectionObserver rootMargin for Inline artifacts. Generous vertical
 * overscan starts init before the frame is fully on screen so scroll-stop
 * never lands on a recycled blank.
 */
export const ARTIFACT_VIEWPORT_ROOT_MARGIN = '480px 0px';

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
/** Sanitized body snapshots from parent → a streaming Artifact iframe. */
export const ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE = 'piwin-artifact:stream-update' as const;
/** User-intent actions from artifact UI → product (strict whitelist). */
export const ARTIFACT_BRIDGE_ACTION_TYPE = 'piwin-artifact:action' as const;

/**
 * Allowed artifact action names. Extend deliberately — every entry is a
 * capability the sandboxed (untrusted) HTML can invoke on the product.
 */
export const COMPOSER_PROPOSE_TEXT_ACTION = 'composer/propose-text' as const;

export const ARTIFACT_ACTION_NAMES = ['flashcard/rate', 'flashcard/open-source', 'composer/propose-text'] as const;

/** YouTube / Maps embeds allowed under default allowlist mode. */
export const DEFAULT_ARTIFACT_IFRAME_ALLOWED_URL_PREFIXES = [
  'https://www.youtube.com/embed/',
  'https://www.youtube-nocookie.com/embed/',
  'https://www.google.com/maps/',
  'https://maps.google.com/',
] as const;

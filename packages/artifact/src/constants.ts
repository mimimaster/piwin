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
/** Temporary paint size while the sandbox reports its real content height. */
export const ARTIFACT_BOOTSTRAP_HEIGHT = 80;
/** Visible bounded degradation when an Inline iframe cannot report height. */
export const ARTIFACT_FALLBACK_HEIGHT = 640;
/**
 * Defensive ceiling for an Inline Artifact that flows with the transcript.
 * Inline no longer owns a 900px scrollport, but model HTML is untrusted and
 * must not be able to request an effectively unbounded iframe height.
 */
export const MAX_ARTIFACT_INLINE_FLOW_HEIGHT = 16_384;
export const ARTIFACT_READY_TIMEOUT_MS = 5000;

/** Max concurrent historical artifact iframe inits (srcdoc assignment). */
export const MAX_CONCURRENT_ARTIFACT_INITS = 1;

/** Priority bands for the live-host registry (higher = keep). */
export const ARTIFACT_LIVE_PRIORITY_VISIBLE = 100;
export const ARTIFACT_LIVE_PRIORITY_STREAM = 1_000;
export const ARTIFACT_LIVE_PRIORITY_CANVAS = 1_000;

/** Single content-size message from an Inline sandbox → parent. */
export const ARTIFACT_BRIDGE_SIZE_TYPE = 'piwin-artifact:size' as const;
/** Sanitized body snapshots from parent → a streaming Artifact iframe. */
export const ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE = 'piwin-artifact:stream-update' as const;
/** User-intent actions from artifact UI → product (strict whitelist). */
export const ARTIFACT_BRIDGE_ACTION_TYPE = 'piwin-artifact:action' as const;

/**
 * Allowed artifact action names. Extend deliberately — every entry is a
 * capability the sandboxed (untrusted) HTML can invoke on the product.
 */
export const COMPOSER_PROPOSE_TEXT_ACTION = 'composer/propose-text' as const;
export const ARTIFACT_DOWNLOAD_UNSUPPORTED_ACTION = 'artifact/download-unsupported' as const;

export const ARTIFACT_ACTION_NAMES = [
  'flashcard/rate',
  'flashcard/open-source',
  'composer/propose-text',
  'artifact/download-unsupported',
] as const;

/** YouTube / Maps embeds allowed under default allowlist mode. */
export const DEFAULT_ARTIFACT_IFRAME_ALLOWED_URL_PREFIXES = [
  'https://www.youtube.com/embed/',
  'https://www.youtube-nocookie.com/embed/',
  'https://www.google.com/maps/',
  'https://maps.google.com/',
] as const;

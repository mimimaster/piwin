/** Artifact policy constants. Canonical fence languages live in @piwin/contracts. */

export {
  ARTIFACT_LANGUAGE_ALIASES,
  CANONICAL_ARTIFACT_LANGUAGE,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
  DEFAULT_MAX_ARTIFACT_BYTES,
} from '@piwin/contracts';

/**
 * Internal Markdown metadata added only to an open native Artifact fence.
 * It lets stream-preview mount before enough body tokens exist for the final
 * native HTML/SVG classifier. The marker is stripped before descriptor output.
 */
export const STREAMING_ARTIFACT_FENCE_MARKER = 'piwin-stream-artifact' as const;

export const MIN_ARTIFACT_IFRAME_HEIGHT = 40;
/** Temporary paint size while the sandbox reports its real content height. */
export const ARTIFACT_BOOTSTRAP_HEIGHT = 80;
/** Compact recovery viewport when an Inline iframe cannot report height. */
export const ARTIFACT_FALLBACK_HEIGHT = 360;
/**
 * Defensive ceiling for an Inline Artifact that flows with the transcript.
 * Inline no longer owns a 900px scrollport, but model HTML is untrusted and
 * must not be able to request an effectively unbounded iframe height.
 */
export const MAX_ARTIFACT_INLINE_FLOW_HEIGHT = 16_384;
/** Host-owned Inline viewport / overflow chrome. Not a second size protocol. */
export const ARTIFACT_INLINE_VIEWPORT_MIN_HEIGHT = 360;
export const ARTIFACT_INLINE_VIEWPORT_MAX_HEIGHT = 760;
export const ARTIFACT_INLINE_VIEWPORT_HEIGHT_VH = 0.72;
export const ARTIFACT_READY_TIMEOUT_MS = 5000;
export const ARTIFACT_FRAME_MODES = [
  'inline-flow',
  'inline-viewport',
  'inline-overflow',
  'canvas',
] as const;

/** Max concurrent historical artifact iframe inits (srcdoc assignment). */
export const MAX_CONCURRENT_ARTIFACT_INITS = 1;

/** Priority bands for Desktop live-host admission (higher = keep). */
export const ARTIFACT_LIVE_PRIORITY_VISIBLE = 100;
export const ARTIFACT_LIVE_PRIORITY_STREAM = 1_000;
export const ARTIFACT_LIVE_PRIORITY_CANVAS = 1_000;

/** Single content-size message from an Inline sandbox → parent. */
export const ARTIFACT_BRIDGE_SIZE_TYPE = 'piwin-artifact:size' as const;
/** Parent request for a fresh size report and optional recovery viewport. */
export const ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE = 'piwin-artifact:measure-request' as const;
/** Sanitized body snapshots from parent → a streaming Artifact iframe. */
export const ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE = 'piwin-artifact:stream-update' as const;
/** User-intent actions from artifact UI → product (strict whitelist). */
export const ARTIFACT_BRIDGE_ACTION_TYPE = 'piwin-artifact:action' as const;

/**
 * Iframe-whitelist action names. Extend deliberately — every entry is a
 * capability the sandboxed (untrusted) HTML can invoke on the product.
 * Flashcard rate/open-source stay on structured FlashcardView, not sandbox HTML.
 */
export const COMPOSER_PROPOSE_TEXT_ACTION = 'composer/propose-text' as const;
export const ARTIFACT_DOWNLOAD_UNSUPPORTED_ACTION = 'artifact/download-unsupported' as const;

export const ARTIFACT_ACTION_NAMES = [
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

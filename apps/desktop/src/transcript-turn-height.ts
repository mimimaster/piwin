/**
 * Transcript virtualizer height policy.
 *
 * Default estimates that are far above real short replies leave absolute-positioned
 * gaps of ink-wash texture between bubbles. Prefer a modest estimate, clamp cache,
 * and always prefer a fresh measure when the row is mounted.
 */
import type { TranscriptTurn } from './transcript-turns';

/** Fallback when we know nothing about the turn (short assistant / user row). */
export const TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX = 140;

/** Reject zero / sub-pixel noise. */
export const TRANSCRIPT_TURN_MIN_HEIGHT_PX = 40;

/**
 * Hard ceiling for cached / estimated heights. Pathological Artifact shells and
 * bad measures must not reserve multi-screen blank for every turn.
 */
export const TRANSCRIPT_TURN_MAX_CACHED_HEIGHT_PX = 4_000;

/** Soft distrust: cached height this many times above content estimate is ignored. */
const CACHED_HEIGHT_DISTRUST_RATIO = 3.5;
const CACHED_HEIGHT_DISTRUST_MIN_PX = 360;

/**
 * Normalize a measured or estimated height for the virtualizer + height cache.
 * Returns null when the value is unusable (caller should fall back to estimate).
 */
export function normalizeTranscriptTurnHeight(height: number): number | null {
  if (!Number.isFinite(height) || height < TRANSCRIPT_TURN_MIN_HEIGHT_PX / 2) {
    return null;
  }
  const rounded = Math.ceil(height);
  if (rounded > TRANSCRIPT_TURN_MAX_CACHED_HEIGHT_PX) {
    return TRANSCRIPT_TURN_MAX_CACHED_HEIGHT_PX;
  }
  return Math.max(TRANSCRIPT_TURN_MIN_HEIGHT_PX, rounded);
}

/**
 * Content-aware size guess before measure. Keeps short turns compact so the
 * scroll range is not inflated by hundreds of empty pixels per row.
 */
export function estimateTranscriptTurnHeight(turn: TranscriptTurn | undefined): number {
  if (turn === undefined) {
    return TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX;
  }
  // User row ~88px chrome; each assistant segment ~120px of prose; tools add more.
  let raw = 56;
  for (const item of turn.items) {
    if (item.message.role === 'user') {
      raw += 88;
      continue;
    }
    const textLength = item.message.text?.length ?? 0;
    const toolCount = item.message.tools?.length ?? 0;
    raw += 72 + Math.min(280, Math.ceil(textLength / 90) * 22) + toolCount * 36;
  }
  return (
    normalizeTranscriptTurnHeight(raw) ?? TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX
  );
}

/**
 * Prefer a trusted cache entry; drop inflated history from tall Artifact frames
 * that later collapsed so the virtualizer remeasures tightly.
 */
export function resolveTranscriptTurnEstimate(options: {
  turn: TranscriptTurn | undefined;
  cachedHeight: number | null;
}): number {
  const contentEstimate = estimateTranscriptTurnHeight(options.turn);
  const cached = options.cachedHeight;
  if (cached === null) {
    return contentEstimate;
  }
  const normalized = normalizeTranscriptTurnHeight(cached);
  if (normalized === null) {
    return contentEstimate;
  }
  if (
    normalized >= CACHED_HEIGHT_DISTRUST_MIN_PX &&
    normalized > contentEstimate * CACHED_HEIGHT_DISTRUST_RATIO
  ) {
    return contentEstimate;
  }
  return normalized;
}

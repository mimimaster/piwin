/**
 * Transcript virtualizer height policy.
 *
 * Default estimates that are far above real short replies leave absolute-positioned
 * gaps of ink-wash texture between bubbles. Estimates and cache entries are
 * bounded; a fresh mounted-row measurement must remain exact.
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
 * Normalize an actual mounted-row measurement. Do not cap it: the virtualizer
 * must reserve the full DOM height or later turns overlap / appear truncated.
 */
export function normalizeTranscriptTurnHeight(height: number): number | null {
  if (!Number.isFinite(height) || height < TRANSCRIPT_TURN_MIN_HEIGHT_PX / 2) {
    return null;
  }
  const rounded = Math.ceil(height);
  return Math.max(TRANSCRIPT_TURN_MIN_HEIGHT_PX, rounded);
}

/** Bound speculative sizes only; mounted rows use normalizeTranscriptTurnHeight. */
export function normalizeTranscriptTurnEstimate(height: number): number | null {
  const normalized = normalizeTranscriptTurnHeight(height);
  return normalized === null ? null : Math.min(TRANSCRIPT_TURN_MAX_CACHED_HEIGHT_PX, normalized);
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
  return normalizeTranscriptTurnEstimate(raw) ?? TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX;
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
  const normalized = normalizeTranscriptTurnEstimate(cached);
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

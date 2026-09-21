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
/** Single assistant image/video before measure. */
const TRANSCRIPT_TURN_HERO_MEDIA_ESTIMATE_PX = 280;
const TRANSCRIPT_TURN_PAIR_MEDIA_ESTIMATE_PX = 220;
const TRANSCRIPT_TURN_GALLERY_ROW_ESTIMATE_PX = 200;

/** Reject zero / sub-pixel noise. */
export const TRANSCRIPT_TURN_MIN_HEIGHT_PX = 40;

/**
 * Hard ceiling for cached / estimated heights. Pathological Artifact shells and
 * bad measures must not reserve multi-screen blank for every turn.
 */
export const TRANSCRIPT_TURN_MAX_CACHED_HEIGHT_PX = 4_000;
/**
 * Safety ceiling for *stored* measured heights (session restore). Live
 * virtualizer rows stay uncapped via normalizeTranscriptTurnHeight.
 * 32k px is ~25–40 viewports; enough for a long delivery, not a runaway iframe.
 */
export const TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX = 32_000;

/** Soft distrust: cached height this many times above content estimate is ignored. */
const CACHED_HEIGHT_DISTRUST_RATIO = 3.5;
const CACHED_HEIGHT_DISTRUST_MIN_PX = 360;
/**
 * Pre-measure prose contribution. 280px was a short-reply cap; a delivery
 * report is thousands of pixels and must not first-paint into a 500px slot.
 */
const TRANSCRIPT_TURN_PROSE_ESTIMATE_MAX_PX = 3_200;
/** Artifact-balloon distrust only applies to compact replies, not long prose. */
const COMPACT_TURN_TEXT_CHARS = 1_500;
const COMPACT_TURN_TOOL_COUNT = 8;

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

function readObserverBlockSize(entry: ResizeObserverEntry | undefined): number {
  const observerBlockSize = entry?.borderBoxSize?.[0]?.blockSize;
  if (typeof observerBlockSize === 'number' && Number.isFinite(observerBlockSize)) {
    return observerBlockSize;
  }
  const contentHeight = entry?.contentRect.height ?? 0;
  return Number.isFinite(contentHeight) ? contentHeight : 0;
}

function readElementNaturalHeight(element: HTMLElement, observerHeight: number): number {
  // When ResizeObserver already delivered a box, do not force layout via
  // offsetHeight / getBoundingClientRect (streaming remasure). scrollHeight
  // still wins if the parent slot clipped the observer box.
  if (observerHeight > 0) {
    return Math.max(observerHeight, element.scrollHeight);
  }
  return Math.max(
    element.offsetHeight,
    element.scrollHeight,
    element.getBoundingClientRect().height,
  );
}

function slotHeightPx(slot: HTMLElement): number {
  if (slot.clientHeight > 0) {
    return slot.clientHeight;
  }
  const styled = Number.parseFloat(slot.style.height || '');
  return Number.isFinite(styled) ? styled : 0;
}

function slotClipsOverflow(slot: HTMLElement): boolean {
  const inline = slot.style.overflowY || slot.style.overflow;
  if (inline === 'visible') {
    return false;
  }
  if (inline === 'hidden' || inline === 'clip') {
    return true;
  }
  if (typeof window.getComputedStyle !== 'function') {
    return false;
  }
  const overflowY = window.getComputedStyle(slot).overflowY;
  return overflowY === 'hidden' || overflowY === 'clip';
}

/**
 * Estimate-locked `overflow: hidden` slots can report their clip box as the
 * body size (WKWebView). Measure then never grows, the turn looks truncated,
 * and the scroll range is too short to move into history.
 */
export function isTranscriptTurnClipDeadlock(slot: HTMLElement, measuredHeight: number): boolean {
  if (!slot.classList.contains('transcript-turn-window-item')) {
    return false;
  }
  const slotHeight = slotHeightPx(slot);
  if (slotHeight <= 0) {
    return false;
  }
  return slotClipsOverflow(slot) && Math.abs(measuredHeight - slotHeight) <= 1;
}

function readHeightWithSlotUnclipped(slot: HTMLElement, body: HTMLElement): number {
  const previousHeight = slot.style.height;
  const previousOverflow = slot.style.overflow;
  const previousOverflowY = slot.style.overflowY;
  slot.style.height = 'auto';
  slot.style.overflow = 'visible';
  slot.style.overflowY = 'visible';
  try {
    return Math.max(body.offsetHeight, body.scrollHeight, body.getBoundingClientRect().height);
  } finally {
    slot.style.height = previousHeight;
    slot.style.overflow = previousOverflow;
    slot.style.overflowY = previousOverflowY;
  }
}

/**
 * Live row size for the virtualizer. The outer slot is `overflow: hidden` at
 * the current estimated height, so ResizeObserver / border-box can report the
 * clipped visible box. `scrollHeight` is the body's natural size and must win.
 * If both are the clip box, briefly unclip the slot and read again.
 */
export function readMountedTranscriptTurnHeight(options: {
  element: HTMLElement;
  entry: ResizeObserverEntry | undefined;
}): number {
  const observerHeight = readObserverBlockSize(options.entry);
  const measured = readElementNaturalHeight(options.element, observerHeight);
  const slot = options.element.parentElement;
  if (!slot || !isTranscriptTurnClipDeadlock(slot, measured)) {
    return measured;
  }
  return Math.max(measured, readHeightWithSlotUnclipped(slot, options.element));
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
function assistantVisualMediaCount(turn: TranscriptTurn): number {
  let count = 0;
  for (const item of turn.items) {
    if (item.message.role !== 'assistant') {
      continue;
    }
    for (const attachment of item.message.attachments) {
      if (attachment.kind !== 'media') {
        continue;
      }
      const mime = attachment.mimeType.toLowerCase();
      if (mime.startsWith('image/') || mime.startsWith('video/')) {
        count += 1;
      }
    }
  }
  return count;
}

function estimateAssistantMediaHeight(count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (count === 1) {
    return TRANSCRIPT_TURN_HERO_MEDIA_ESTIMATE_PX;
  }
  if (count === 2) {
    return TRANSCRIPT_TURN_PAIR_MEDIA_ESTIMATE_PX;
  }
  return TRANSCRIPT_TURN_GALLERY_ROW_ESTIMATE_PX * Math.ceil(count / 2);
}

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
    raw += 72 + Math.min(TRANSCRIPT_TURN_PROSE_ESTIMATE_MAX_PX, Math.ceil(textLength / 90) * 22) + toolCount * 36;
  }
  raw += estimateAssistantMediaHeight(assistantVisualMediaCount(turn));
  return normalizeTranscriptTurnEstimate(raw) ?? TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX;
}

function transcriptTurnLooksCompact(turn: TranscriptTurn | undefined): boolean {
  if (turn === undefined) {
    return true;
  }
  let textLength = 0;
  let toolCount = 0;
  for (const item of turn.items) {
    textLength += item.message.text?.length ?? 0;
    toolCount += item.message.tools?.length ?? 0;
  }
  return textLength < COMPACT_TURN_TEXT_CHARS && toolCount < COMPACT_TURN_TOOL_COUNT;
}

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
  // Collapsed Artifact shells left multi-screen blanks on short replies.
  // Long prose / tool-heavy turns are actually that tall — keep the cache.
  if (
    transcriptTurnLooksCompact(options.turn) &&
    normalized >= CACHED_HEIGHT_DISTRUST_MIN_PX &&
    normalized > contentEstimate * CACHED_HEIGHT_DISTRUST_RATIO
  ) {
    return contentEstimate;
  }
  return normalized;
}

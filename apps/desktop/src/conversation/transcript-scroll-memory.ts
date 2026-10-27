import {
  TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX,
  TRANSCRIPT_TURN_MIN_HEIGHT_PX,
} from './transcript-turn-height';
import {
  clearStoredTranscriptReadingPositions,
  readStoredTranscriptReadingPosition,
  removeStoredTranscriptReadingPosition,
  writeStoredTranscriptReadingPosition,
  type TranscriptReadingPosition,
} from './transcript-reading-storage.js';
import {
  clearStoredTurnHeights,
  readStoredTurnHeights,
  removeStoredTurnHeights,
  writeStoredTurnHeights,
} from './transcript-turn-height-storage.js';

/**
 * Where the reader was, by message rather than scrollTop: a remounted
 * virtualizer, another page window or a new column width all make the same
 * scrollTop point at different content.
 */
export type TranscriptScrollPosition = TranscriptReadingPosition;

const MAX_REMEMBERED_SESSIONS = 20;
const MAX_REMEMBERED_TURNS_PER_SESSION = 2_000;
/** Text reflows at a different column width; a pixel of rounding does not. */
const TURN_HEIGHT_WIDTH_TOLERANCE_PX = 2;
/** Heights settle in bursts (a scroll, a stream); write once the burst is over. */
const TURN_HEIGHT_PERSIST_DELAY_MS = 1_000;
type TranscriptSessionScrollMemory = {
  position: TranscriptScrollPosition | null;
  turnHeightsById: Map<string, number>;
  /** Column width the remembered heights were measured at; null until known. */
  turnHeightsWidthPx: number | null;
};

function isSameColumnWidth(storedWidthPx: number | null, widthPx: number | undefined): boolean {
  if (storedWidthPx === null || widthPx === undefined || widthPx <= 0) {
    return true;
  }
  return Math.abs(storedWidthPx - widthPx) <= TURN_HEIGHT_WIDTH_TOLERANCE_PX;
}

const scrollMemoryBySessionId = new Map<string, TranscriptSessionScrollMemory>();

function readSessionMemory(sessionId: string): TranscriptSessionScrollMemory | null {
  const memory = scrollMemoryBySessionId.get(sessionId);
  if (!memory) {
    return null;
  }
  scrollMemoryBySessionId.delete(sessionId);
  scrollMemoryBySessionId.set(sessionId, memory);
  return memory;
}

const pendingHeightWrites = new Map<string, ReturnType<typeof setTimeout>>();
let pageHideFlushInstalled = false;

function persistTurnHeights(sessionId: string): void {
  const timer = pendingHeightWrites.get(sessionId);
  if (timer !== undefined) clearTimeout(timer);
  pendingHeightWrites.delete(sessionId);
  const memory = scrollMemoryBySessionId.get(sessionId);
  if (!memory || memory.turnHeightsById.size === 0) return;
  writeStoredTurnHeights(sessionId, {
    widthPx: memory.turnHeightsWidthPx,
    heights: Array.from(memory.turnHeightsById),
  });
}

/** Write every pending session now (the window is going away). */
export function flushTranscriptTurnHeights(): void {
  for (const sessionId of Array.from(pendingHeightWrites.keys())) persistTurnHeights(sessionId);
}

function schedulePersistTurnHeights(sessionId: string): void {
  if (pendingHeightWrites.has(sessionId)) return;
  if (!pageHideFlushInstalled && typeof window !== 'undefined') {
    pageHideFlushInstalled = true;
    window.addEventListener('pagehide', flushTranscriptTurnHeights);
  }
  pendingHeightWrites.set(
    sessionId,
    setTimeout(() => persistTurnHeights(sessionId), TURN_HEIGHT_PERSIST_DELAY_MS),
  );
}

function ensureSessionMemory(sessionId: string): TranscriptSessionScrollMemory {
  const existingMemory = readSessionMemory(sessionId);
  if (existingMemory) {
    return existingMemory;
  }
  // First use this run: start from the heights measured last time.
  const stored = readStoredTurnHeights(sessionId);
  const memory: TranscriptSessionScrollMemory = {
    position: null,
    turnHeightsById: new Map(stored?.heights ?? []),
    turnHeightsWidthPx: stored?.widthPx ?? null,
  };
  scrollMemoryBySessionId.set(sessionId, memory);
  const oldestSessionId = scrollMemoryBySessionId.keys().next().value;
  if (scrollMemoryBySessionId.size > MAX_REMEMBERED_SESSIONS && oldestSessionId !== undefined) {
    scrollMemoryBySessionId.delete(oldestSessionId);
  }
  return memory;
}

/**
 * Small LRU: positions and measured heights are presentation state, not
 * product authority. Positions are also persisted so a restart can resume.
 */
export function rememberTranscriptScrollPosition(
  sessionId: string,
  position: TranscriptScrollPosition,
): void {
  ensureSessionMemory(sessionId).position = position;
  writeStoredTranscriptReadingPosition(sessionId, position);
}

export function readTranscriptScrollPosition(sessionId: string): TranscriptScrollPosition | null {
  return (
    readSessionMemory(sessionId)?.position ?? readStoredTranscriptReadingPosition(sessionId)
  );
}

export function forgetTranscriptScrollPosition(sessionId: string): void {
  const timer = pendingHeightWrites.get(sessionId);
  if (timer !== undefined) clearTimeout(timer);
  pendingHeightWrites.delete(sessionId);
  scrollMemoryBySessionId.delete(sessionId);
  removeStoredTranscriptReadingPosition(sessionId);
  removeStoredTurnHeights(sessionId);
}

/**
 * `widthPx` is the column the turn was measured in. Heights from another width
 * are wrong by however much the text re-wrapped, so a width change drops them:
 * a stale height used as an estimate made every turn jump once on mount after
 * the window or a side panel was resized.
 */
export function rememberTranscriptTurnHeight(
  sessionId: string,
  turnId: string,
  height: number,
  widthPx?: number,
): void {
  // Store the measured height. Artifact balloons on short replies are
  // discarded by resolveTranscriptTurnEstimate, not by clipping the cache —
  // a long delivery is actually several thousand pixels.
  const normalized = Math.ceil(height);
  if (!Number.isFinite(normalized) || normalized < TRANSCRIPT_TURN_MIN_HEIGHT_PX / 2) {
    return;
  }
  const stored = Math.min(
    TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX,
    Math.max(TRANSCRIPT_TURN_MIN_HEIGHT_PX, normalized),
  );
  const memory = ensureSessionMemory(sessionId);
  if (!isSameColumnWidth(memory.turnHeightsWidthPx, widthPx)) {
    memory.turnHeightsById.clear();
  }
  if (widthPx !== undefined && widthPx > 0) {
    memory.turnHeightsWidthPx = widthPx;
  }
  const heightsByTurnId = memory.turnHeightsById;
  const changed = heightsByTurnId.get(turnId) !== stored;
  heightsByTurnId.delete(turnId);
  heightsByTurnId.set(turnId, stored);
  if (changed) schedulePersistTurnHeights(sessionId);
  const oldestTurnId = heightsByTurnId.keys().next().value;
  if (heightsByTurnId.size > MAX_REMEMBERED_TURNS_PER_SESSION && oldestTurnId !== undefined) {
    heightsByTurnId.delete(oldestTurnId);
  }
}

export function readTranscriptTurnHeight(
  sessionId: string,
  turnId: string,
  widthPx?: number,
): number | null {
  const memory = ensureSessionMemory(sessionId);
  if (!isSameColumnWidth(memory.turnHeightsWidthPx, widthPx)) {
    return null;
  }
  const heightsByTurnId = memory.turnHeightsById;
  const height = heightsByTurnId.get(turnId);
  if (height === undefined) {
    return null;
  }
  // Drop absurd legacy entries so the virtualizer remeasures from content.
  if (
    !Number.isFinite(height) ||
    height < TRANSCRIPT_TURN_MIN_HEIGHT_PX / 2 ||
    height > TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX
  ) {
    heightsByTurnId.delete(turnId);
    return null;
  }
  heightsByTurnId.delete(turnId);
  heightsByTurnId.set(turnId, height);
  return height;
}

export function clearTranscriptScrollPositionsForTests(): void {
  for (const timer of pendingHeightWrites.values()) clearTimeout(timer);
  pendingHeightWrites.clear();
  scrollMemoryBySessionId.clear();
  clearStoredTranscriptReadingPositions();
  clearStoredTurnHeights();
}

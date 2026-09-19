import {
  TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX,
  TRANSCRIPT_TURN_MIN_HEIGHT_PX,
} from './transcript-turn-height';

export type TranscriptScrollPosition = {
  scrollTop: number;
  followTail: boolean;
};

const MAX_REMEMBERED_SESSIONS = 20;
const MAX_REMEMBERED_TURNS_PER_SESSION = 2_000;
type TranscriptSessionScrollMemory = {
  position: TranscriptScrollPosition | null;
  turnHeightsById: Map<string, number>;
};

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

function ensureSessionMemory(sessionId: string): TranscriptSessionScrollMemory {
  const existingMemory = readSessionMemory(sessionId);
  if (existingMemory) {
    return existingMemory;
  }
  const memory: TranscriptSessionScrollMemory = {
    position: null,
    turnHeightsById: new Map(),
  };
  scrollMemoryBySessionId.set(sessionId, memory);
  const oldestSessionId = scrollMemoryBySessionId.keys().next().value;
  if (scrollMemoryBySessionId.size > MAX_REMEMBERED_SESSIONS && oldestSessionId !== undefined) {
    scrollMemoryBySessionId.delete(oldestSessionId);
  }
  return memory;
}

/** Small LRU: offsets and measured heights are presentation state, not product authority. */
export function rememberTranscriptScrollPosition(
  sessionId: string,
  position: TranscriptScrollPosition,
): void {
  ensureSessionMemory(sessionId).position = position;
}

export function readTranscriptScrollPosition(sessionId: string): TranscriptScrollPosition | null {
  return readSessionMemory(sessionId)?.position ?? null;
}

export function forgetTranscriptScrollPosition(sessionId: string): void {
  scrollMemoryBySessionId.delete(sessionId);
}

export function rememberTranscriptTurnHeight(
  sessionId: string,
  turnId: string,
  height: number,
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
  const heightsByTurnId = ensureSessionMemory(sessionId).turnHeightsById;
  heightsByTurnId.delete(turnId);
  heightsByTurnId.set(turnId, stored);
  const oldestTurnId = heightsByTurnId.keys().next().value;
  if (heightsByTurnId.size > MAX_REMEMBERED_TURNS_PER_SESSION && oldestTurnId !== undefined) {
    heightsByTurnId.delete(oldestTurnId);
  }
}

export function readTranscriptTurnHeight(sessionId: string, turnId: string): number | null {
  const heightsByTurnId = readSessionMemory(sessionId)?.turnHeightsById;
  if (!heightsByTurnId) {
    return null;
  }
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
  scrollMemoryBySessionId.clear();
}

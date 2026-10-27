/**
 * Measured turn heights survive a restart, so the first open of a session
 * lays out at its real heights instead of estimates and the opening cover can
 * lift as soon as the rows are on screen. One key per session (heights are
 * read once, when a session first opens) plus an LRU index of sessions.
 */
import {
  TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX,
  TRANSCRIPT_TURN_MIN_HEIGHT_PX,
} from './transcript-turn-height';
import { createPresentationStore, type PresentationStorage } from './presentation-storage.js';

export const TURN_HEIGHT_STORAGE_INDEX_KEY = 'piwin.desktop.turnHeights.v1';
export const TURN_HEIGHT_STORAGE_KEY_PREFIX = 'piwin.desktop.turnHeights.v1:';
export const MAX_STORED_TURN_HEIGHT_SESSIONS = 24;
/** Newest turns only; a reopen paints the tail first. ~50 bytes each. */
export const MAX_STORED_TURN_HEIGHTS_PER_SESSION = 400;
const MAX_ID_LENGTH = 256;

export type StoredTurnHeights = {
  /** Column width the heights were measured at; null when unknown. */
  widthPx: number | null;
  /** Oldest first. */
  heights: Array<[turnId: string, heightPx: number]>;
};

const store = createPresentationStore('Transcript row heights');

function sessionKey(sessionId: string): string {
  return `${TURN_HEIGHT_STORAGE_KEY_PREFIX}${sessionId}`;
}

function isStoredHeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= TRANSCRIPT_TURN_MIN_HEIGHT_PX &&
    value <= TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX
  );
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

export function parseStoredTurnHeights(value: unknown): StoredTurnHeights | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.heights)) return null;
  const widthPx =
    typeof record.widthPx === 'number' && Number.isFinite(record.widthPx) && record.widthPx > 0
      ? record.widthPx
      : null;
  const heights: StoredTurnHeights['heights'] = [];
  for (const entry of record.heights) {
    if (Array.isArray(entry) && isId(entry[0]) && isStoredHeight(entry[1])) {
      heights.push([entry[0], entry[1]]);
    }
  }
  return { widthPx, heights };
}

function readIndex(storage: PresentationStorage): string[] {
  const parsed = store.readJson(storage, TURN_HEIGHT_STORAGE_INDEX_KEY);
  return Array.isArray(parsed) ? parsed.filter(isId) : [];
}

export function readStoredTurnHeights(
  sessionId: string,
  storage: PresentationStorage | null = store.defaultStorage(),
): StoredTurnHeights | null {
  if (!storage) return null;
  return parseStoredTurnHeights(store.readJson(storage, sessionKey(sessionId)));
}

export function writeStoredTurnHeights(
  sessionId: string,
  value: StoredTurnHeights,
  storage: PresentationStorage | null = store.defaultStorage(),
): void {
  if (!storage) return;
  const index = readIndex(storage).filter((id) => id !== sessionId);
  index.push(sessionId);
  for (const evicted of index.splice(0, Math.max(0, index.length - MAX_STORED_TURN_HEIGHT_SESSIONS))) {
    store.writeJson(storage, sessionKey(evicted), null);
  }
  store.writeJson(storage, sessionKey(sessionId), {
    widthPx: value.widthPx,
    heights: value.heights.slice(-MAX_STORED_TURN_HEIGHTS_PER_SESSION),
  });
  store.writeJson(storage, TURN_HEIGHT_STORAGE_INDEX_KEY, index);
}

export function removeStoredTurnHeights(
  sessionId: string,
  storage: PresentationStorage | null = store.defaultStorage(),
): void {
  if (!storage) return;
  const index = readIndex(storage);
  store.writeJson(storage, sessionKey(sessionId), null);
  if (index.includes(sessionId)) {
    const kept = index.filter((id) => id !== sessionId);
    store.writeJson(storage, TURN_HEIGHT_STORAGE_INDEX_KEY, kept.length === 0 ? null : kept);
  }
}

export function clearStoredTurnHeights(
  storage: PresentationStorage | null = store.defaultStorage(),
): void {
  if (!storage) return;
  for (const sessionId of readIndex(storage)) store.writeJson(storage, sessionKey(sessionId), null);
  store.writeJson(storage, TURN_HEIGHT_STORAGE_INDEX_KEY, null);
}

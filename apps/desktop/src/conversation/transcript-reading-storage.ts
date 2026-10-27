/**
 * Reading positions survive a restart in localStorage. They are presentation
 * state (which message the reader had on screen), not product authority, so
 * a missing or broken store only means opening at the live tail.
 */
import type { TranscriptReadingAnchor } from './transcript-reading-anchor.js';
import { createPresentationStore, type PresentationStorage } from './presentation-storage.js';

export type TranscriptReadingPosition = {
  followTail: boolean;
  /** Message at the top of the viewport when the reader left; null at the tail. */
  anchor: TranscriptReadingAnchor | null;
  /** Last message the reader had seen; new rows after it count as unseen. */
  lastSeenMessageId: string | null;
  /** Last user message when the reader left; its still-running turn is not a new send. */
  lastUserMessageId: string | null;
};

export const TRANSCRIPT_READING_STORAGE_KEY = 'piwin.desktop.transcriptReading.v1';
export const MAX_STORED_READING_POSITIONS = 50;
const MAX_ID_LENGTH = 256;

type ReadingStorage = PresentationStorage;

const store = createPresentationStore('Transcript reading positions');
const defaultStorage = store.defaultStorage;

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    ? value
    : null;
}

function parseAnchor(value: unknown): TranscriptReadingAnchor | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const messageId = readId(record.messageId);
  const offset = record.offset;
  if (messageId === null || typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  return { messageId, offset };
}

export function parseTranscriptReadingPosition(value: unknown): TranscriptReadingPosition | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.followTail !== 'boolean') return null;
  const anchor = parseAnchor(record.anchor);
  // A reader in history without a message to return to has no position.
  if (!record.followTail && anchor === null) return null;
  return {
    followTail: record.followTail,
    anchor: record.followTail ? null : anchor,
    lastSeenMessageId: readId(record.lastSeenMessageId),
    lastUserMessageId: readId(record.lastUserMessageId),
  };
}

/** Oldest first, so the LRU drops from the front. */
function readEntries(storage: ReadingStorage): Array<[string, TranscriptReadingPosition]> {
  const parsed = store.readJson(storage, TRANSCRIPT_READING_STORAGE_KEY);
  if (!Array.isArray(parsed)) return [];
  const entries: Array<[string, TranscriptReadingPosition]> = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry)) continue;
    const sessionId = readId(entry[0]);
    const position = parseTranscriptReadingPosition(entry[1]);
    if (sessionId !== null && position !== null) entries.push([sessionId, position]);
  }
  return entries;
}

function writeEntries(
  storage: ReadingStorage,
  entries: ReadonlyArray<[string, TranscriptReadingPosition]>,
): void {
  store.writeJson(storage, TRANSCRIPT_READING_STORAGE_KEY, entries.length === 0 ? null : entries);
}

export function readStoredTranscriptReadingPosition(
  sessionId: string,
  storage: ReadingStorage | null = defaultStorage(),
): TranscriptReadingPosition | null {
  if (!storage) return null;
  return readEntries(storage).find(([id]) => id === sessionId)?.[1] ?? null;
}

export function writeStoredTranscriptReadingPosition(
  sessionId: string,
  position: TranscriptReadingPosition,
  storage: ReadingStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const entries = readEntries(storage).filter(([id]) => id !== sessionId);
  entries.push([sessionId, position]);
  writeEntries(storage, entries.slice(-MAX_STORED_READING_POSITIONS));
}

export function removeStoredTranscriptReadingPosition(
  sessionId: string,
  storage: ReadingStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const entries = readEntries(storage);
  const kept = entries.filter(([id]) => id !== sessionId);
  if (kept.length !== entries.length) writeEntries(storage, kept);
}

export function clearStoredTranscriptReadingPositions(
  storage: ReadingStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  writeEntries(storage, []);
}

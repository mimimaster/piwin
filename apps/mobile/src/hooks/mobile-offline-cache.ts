import type { RemoteProjectSummary, RemoteSessionSummary } from '@piwin/contracts';

/**
 * Device-local copies that make a cold start or a dropped connection readable:
 * the last session list the Host sent, and per-session composer drafts. They
 * are display conveniences only — the Host list replaces the snapshot as soon
 * as it arrives, and nothing here is ever sent back as Host state.
 *
 * Keys are scoped by Host endpoint so two Hosts never mix.
 */
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_SESSIONS = 200;
const MAX_PREVIEW_CHARS = 160;
const MAX_DRAFTS = 30;
const MAX_DRAFT_CHARS = 20_000;

export interface SessionListSnapshot {
  version: typeof SNAPSHOT_VERSION;
  savedAt: string;
  sessions: RemoteSessionSummary[];
  projects: RemoteProjectSummary[];
}

type DraftBook = Record<string, { text: string; at: string }>;

function snapshotKey(endpoint: string): string {
  return `piwin.mobile.session-snapshot.v1.${encodeURIComponent(endpoint.trim())}`;
}

function draftsKey(endpoint: string): string {
  return `piwin.mobile.drafts.v1.${encodeURIComponent(endpoint.trim())}`;
}

export function writeSessionSnapshot(
  storage: KeyValueStorage | undefined,
  endpoint: string,
  sessions: readonly RemoteSessionSummary[],
  projects: readonly RemoteProjectSummary[],
  now: Date = new Date(),
): void {
  if (storage === undefined || endpoint.trim().length === 0) return;
  const snapshot: SessionListSnapshot = {
    version: SNAPSHOT_VERSION,
    savedAt: now.toISOString(),
    sessions: sessions.slice(0, MAX_SNAPSHOT_SESSIONS).map((session) =>
      session.lastPreview !== undefined && session.lastPreview.length > MAX_PREVIEW_CHARS
        ? { ...session, lastPreview: session.lastPreview.slice(0, MAX_PREVIEW_CHARS) }
        : session,
    ),
    // Host filesystem paths stay off the device copy; the list only needs names.
    projects: projects.map(({ projectId, displayName }) => ({ projectId, displayName })),
  };
  safeSet(storage, snapshotKey(endpoint), JSON.stringify(snapshot));
}

export function readSessionSnapshot(
  storage: KeyValueStorage | undefined,
  endpoint: string,
): SessionListSnapshot | undefined {
  const raw = safeGet(storage, snapshotKey(endpoint));
  if (raw === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { version?: unknown }).version !== SNAPSHOT_VERSION ||
      !Array.isArray((value as { sessions?: unknown }).sessions) ||
      !Array.isArray((value as { projects?: unknown }).projects) ||
      typeof (value as { savedAt?: unknown }).savedAt !== 'string'
    ) {
      return undefined;
    }
    const snapshot = value as SessionListSnapshot;
    return {
      ...snapshot,
      sessions: snapshot.sessions.filter(
        (session) => typeof session === 'object' && session !== null && typeof session.sessionId === 'string',
      ),
    };
  } catch (error: unknown) {
    console.warn('[mobile] dropping unreadable session snapshot', error);
    return undefined;
  }
}

export function readDraft(storage: KeyValueStorage | undefined, endpoint: string, sessionId: string): string {
  return readDraftBook(storage, endpoint)[sessionId]?.text ?? '';
}

/** Empty text removes the draft; the book keeps the most recent drafts only. */
export function writeDraft(
  storage: KeyValueStorage | undefined,
  endpoint: string,
  sessionId: string,
  text: string,
  now: Date = new Date(),
): void {
  if (storage === undefined || endpoint.trim().length === 0) return;
  const book = readDraftBook(storage, endpoint);
  if (text.trim().length === 0) {
    if (book[sessionId] === undefined) return;
    delete book[sessionId];
  } else {
    book[sessionId] = { text: text.slice(0, MAX_DRAFT_CHARS), at: now.toISOString() };
  }
  const kept = Object.entries(book)
    .sort(([, left], [, right]) => right.at.localeCompare(left.at))
    .slice(0, MAX_DRAFTS);
  if (kept.length === 0) {
    safeRemove(storage, draftsKey(endpoint));
    return;
  }
  safeSet(storage, draftsKey(endpoint), JSON.stringify(Object.fromEntries(kept)));
}

function readDraftBook(storage: KeyValueStorage | undefined, endpoint: string): DraftBook {
  const raw = safeGet(storage, draftsKey(endpoint));
  if (raw === undefined) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return {};
    const book: DraftBook = {};
    for (const [sessionId, entry] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { text?: unknown }).text === 'string' &&
        typeof (entry as { at?: unknown }).at === 'string'
      ) {
        book[sessionId] = entry as DraftBook[string];
      }
    }
    return book;
  } catch (error: unknown) {
    console.warn('[mobile] dropping unreadable drafts', error);
    return {};
  }
}

function safeGet(storage: KeyValueStorage | undefined, key: string): string | undefined {
  try {
    return storage?.getItem(key) ?? undefined;
  } catch (error: unknown) {
    console.warn('[mobile] local storage read failed', error);
    return undefined;
  }
}

function safeSet(storage: KeyValueStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (error: unknown) {
    // Quota or blocked storage: the cache is optional, the app keeps working.
    console.warn('[mobile] local storage write failed', error);
  }
}

function safeRemove(storage: KeyValueStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch (error: unknown) {
    console.warn('[mobile] local storage remove failed', error);
  }
}

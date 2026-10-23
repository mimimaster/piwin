/**
 * Small per-session value store in localStorage, shared by the surfaces whose
 * layout follows the conversation (right panel tabs, docked right tools).
 *
 * Entries are kept in most-recently-written order and capped, so sessions the
 * user never reopens age out instead of growing the key forever.
 */

export const SESSION_KEYED_MEMORY_LIMIT = 100;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

type StoredEntries = Array<[sessionId: string, value: unknown]>;

function readEntries(storage: Storage, key: string): StoredEntries {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, unknown] =>
        Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string',
    );
  } catch {
    // A damaged entry only loses remembered layouts; the live layout stays.
    return [];
  }
}

export function readSessionKeyedValue<T>(
  key: string,
  sessionId: string,
  parse: (value: unknown) => T | null,
  storage: Storage | null = defaultStorage(),
): T | null {
  if (!storage) return null;
  const entry = readEntries(storage, key).find(([id]) => id === sessionId);
  return entry ? parse(entry[1]) : null;
}

export function writeSessionKeyedValue(
  key: string,
  sessionId: string,
  value: unknown,
  storage: Storage | null = defaultStorage(),
  limit: number = SESSION_KEYED_MEMORY_LIMIT,
): void {
  if (!storage) return;
  const rest = readEntries(storage, key).filter(([id]) => id !== sessionId);
  const entry: [string, unknown] = [sessionId, value];
  const next: StoredEntries = [entry, ...rest].slice(0, limit);
  try {
    storage.setItem(key, JSON.stringify(next));
  } catch {
    // Quota errors drop the memory, never the live layout.
  }
}

function defaultStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/**
 * localStorage access for transcript presentation state (reading positions,
 * row heights). It is a convenience, not product authority: a blocked,
 * full or corrupt store reads as empty and writes become no-ops, with one
 * warning per store so a broken store does not flood the console.
 */
export type PresentationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type PresentationStore = {
  /** The window's localStorage, or null when it cannot be reached. */
  defaultStorage: () => PresentationStorage | null;
  /** Parsed JSON at `key`; undefined when absent, unreadable or corrupt. */
  readJson: (storage: PresentationStorage, key: string) => unknown;
  /** Write JSON at `key`, or remove it for `null`. */
  writeJson: (storage: PresentationStorage, key: string, value: unknown) => void;
};

export function createPresentationStore(label: string): PresentationStore {
  let failureLogged = false;
  const reportFailure = (error: unknown): void => {
    // One line is enough: every later read or write would fail the same way.
    if (failureLogged) return;
    failureLogged = true;
    console.warn(`${label} are not persisted:`, error);
  };
  return {
    defaultStorage: () => {
      try {
        return typeof window === 'undefined' ? null : window.localStorage;
      } catch (error) {
        reportFailure(error);
        return null;
      }
    },
    readJson: (storage, key) => {
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch (error) {
        reportFailure(error);
        return undefined;
      }
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        // A corrupt value is replaced by the next write; there is nothing to keep.
        return undefined;
      }
    },
    writeJson: (storage, key, value) => {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(value));
      } catch (error) {
        reportFailure(error);
      }
    },
  };
}

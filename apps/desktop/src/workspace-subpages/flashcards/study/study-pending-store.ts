import type { FlashcardStudyPendingRecord, FlashcardStudyPendingStore } from '@piwin/host-client';

const STORAGE_KEY = 'piwin.desktop.flashcardStudy.pending';

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createDesktopFlashcardStudyPendingStore(): FlashcardStudyPendingStore {
  return {
    async load() {
      const raw = storage()?.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as FlashcardStudyPendingRecord;
        if (!parsed || typeof parsed.roundId !== 'string' || typeof parsed.idempotencyKey !== 'string') {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    async save(record) {
      try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify(record));
      } catch {
        // private-mode / quota — in-flight pending stays in controller memory
      }
    },
    async clear() {
      try {
        storage()?.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    },
  };
}

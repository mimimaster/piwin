import type { FlashcardStudyPendingRecord, FlashcardStudyPendingStore } from '@piwin/host-client';

const STORAGE_KEY = 'piwin.mobile.flashcardStudy.pending';

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isPendingRecord(value: unknown): value is FlashcardStudyPendingRecord {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.roundId === 'string' && typeof record.idempotencyKey === 'string';
}

/** Domain adapter over existing mobile localStorage device-state. No secrets or card copies. */
export function createMobileFlashcardStudyPendingStore(): FlashcardStudyPendingStore {
  return {
    async load() {
      const raw = storage()?.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isPendingRecord(parsed) ? parsed : null;
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

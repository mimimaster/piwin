import type { HostCommand } from '@piwin/contracts';

export type FlashcardStudyPendingRecord = {
  hostIdentity?: string;
  roundId: string;
  idempotencyKey: string;
  command: HostCommand;
  expectedRevision: number;
  controlEpoch: number;
  contentVersion?: string;
};

export type FlashcardStudyPendingStore = {
  load: () => Promise<FlashcardStudyPendingRecord | null>;
  save: (record: FlashcardStudyPendingRecord) => Promise<void>;
  clear: () => Promise<void>;
};

export function createMemoryFlashcardStudyPendingStore(): FlashcardStudyPendingStore {
  let record: FlashcardStudyPendingRecord | null = null;
  return {
    load: async () => record,
    save: async (next) => {
      record = next;
    },
    clear: async () => {
      record = null;
    },
  };
}

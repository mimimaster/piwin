/**
 * What each session last wrote to each file, and whether someone else has
 * touched that file since.
 *
 * `write_file` / `delete_file` overwrite whole files. With shells no longer
 * serialized against them, a session can clobber a change another session
 * (or its shell) made after this session's own last write. The ledger keeps
 * the content hash of that last write; a later write that finds different
 * bytes *and* sees other-session activity in the window is refused once so
 * the model re-reads. Drift with no foreign activity is this session's own
 * shell (a formatter, codegen) or an external editor — allowed, as before.
 *
 * Host cannot see `read` (it runs in the worker), so the first write after a
 * read is not covered; only write-after-write is.
 */
import type { WorkspaceActivitySummary } from './workspace-activity-log.js';

export type SessionFileLedgerEntry = {
  /** sha256 of the bytes this owner left; null after a delete. */
  sha: string | null;
  tick: number;
};

export type SessionFileLedger = {
  lookup(ownerId: string, fileKey: string): SessionFileLedgerEntry | undefined;
  record(ownerId: string, fileKey: string, entry: SessionFileLedgerEntry): void;
};

export const DEFAULT_SESSION_FILE_LEDGER_CAPACITY = 20_000;

export function createSessionFileLedger(
  options: { capacity?: number } = {},
): SessionFileLedger {
  const capacity = Math.max(1, options.capacity ?? DEFAULT_SESSION_FILE_LEDGER_CAPACITY);
  const entries = new Map<string, SessionFileLedgerEntry>();
  const keyOf = (ownerId: string, fileKey: string): string => `${ownerId}\0${fileKey}`;
  return {
    lookup: (ownerId, fileKey) => entries.get(keyOf(ownerId, fileKey)),
    record(ownerId, fileKey, entry) {
      const key = keyOf(ownerId, fileKey);
      // Re-insert so Map order tracks recency; evict the least recent.
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > capacity) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
    },
  };
}

export type ForeignFileChangeVerdict =
  | { conflict: false }
  | { conflict: true; byHostWrite: boolean };

/**
 * Pure decision: refuse only when the bytes moved *and* another owner was
 * active on that file (Host write) or that workspace (exclusive, shell) since
 * this owner's last write. Shells are ambiguous — Host does not know which
 * files a shell touched — so when this owner also ran shells in the window
 * (its own formatter or codegen is the likelier cause), stay optimistic.
 * Missing history stays optimistic too.
 */
export function judgeForeignFileChange(input: {
  entry: SessionFileLedgerEntry | undefined;
  currentSha: string | null;
  others: WorkspaceActivitySummary;
  ownShellCount: number;
}): ForeignFileChangeVerdict {
  if (input.entry === undefined || input.entry.sha === input.currentSha) {
    return { conflict: false };
  }
  if (!input.others.complete) {
    return { conflict: false };
  }
  const byHostWrite = input.others.fileWrites.length > 0;
  const foreignShellOnly = input.others.shellCount > 0 && input.ownShellCount === 0;
  if (byHostWrite || input.others.exclusiveCount > 0 || foreignShellOnly) {
    return { conflict: true, byHostWrite };
  }
  return { conflict: false };
}

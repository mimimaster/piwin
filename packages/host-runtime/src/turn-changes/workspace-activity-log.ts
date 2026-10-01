/**
 * Bounded record of who touched which workspace, on a logical clock.
 *
 * The write gate no longer serializes ordinary shell commands against file
 * writes, so correctness moves from prevention to detection: a shell asks
 * "did another session write here while I ran?", and a file write asks "did
 * another session touch this file since my last write?". Both questions are
 * answered from this log.
 *
 * Ticks, not wall time: one counter step per begin/end keeps ordering exact
 * without clock reads. Overlap is `[startTick, endTick)` against the window.
 */
import { workspaceRootsOverlap } from './workspace-root.js';

export type WorkspaceActivityKind = 'file-write' | 'exclusive' | 'shell';

export type WorkspaceActivityHandle = {
  readonly startTick: number;
  end(): void;
};

export type WorkspaceActivitySummary = {
  /** False when the window starts before the oldest retained activity. */
  complete: boolean;
  /** Canonical file keys other owners wrote through Host file tools. */
  fileWrites: string[];
  /** Other owners' exclusive holders (Git, integrate, listed shells). */
  exclusiveCount: number;
  /** Other owners' shell commands that ran in the window. */
  shellCount: number;
};

export type WorkspaceActivityLog = {
  now(): number;
  begin(input: {
    root: string;
    kind: WorkspaceActivityKind;
    ownerId?: string;
    fileKeys?: readonly string[];
  }): WorkspaceActivityHandle;
  /**
   * Activity by owners other than `ownerId` on an overlapping root that was
   * live at any point after `fromTick`. Unowned activity (Host Git commands,
   * integrate) always counts as other. With `fileKey`, file writes only count
   * when they touched that file; shells and exclusive holders always count.
   */
  othersSince(input: {
    root: string;
    fromTick: number;
    ownerId?: string;
    fileKey?: string;
  }): WorkspaceActivitySummary;
  /** This owner's own shell commands live after `fromTick` on an overlapping root. */
  ownShellCountSince(input: { root: string; fromTick: number; ownerId: string }): number;
};

type ActivityRecord = {
  root: string;
  kind: WorkspaceActivityKind;
  ownerId: string | undefined;
  fileKeys: readonly string[];
  startTick: number;
  endTick: number | null;
};

/** Enough for hours of busy multi-session work; older windows report incomplete. */
export const DEFAULT_WORKSPACE_ACTIVITY_CAPACITY = 4_000;

export function createWorkspaceActivityLog(
  options: { capacity?: number } = {},
): WorkspaceActivityLog {
  const capacity = Math.max(1, options.capacity ?? DEFAULT_WORKSPACE_ACTIVITY_CAPACITY);
  const records: ActivityRecord[] = [];
  let tick = 0;
  /** Highest tick whose evidence has been dropped by eviction. */
  let evictedThrough = -1;

  function evict(): void {
    // Never drop a live record: an open shell must still see it at its end.
    while (records.length > capacity) {
      const index = records.findIndex((record) => record.endTick !== null);
      if (index < 0) {
        return;
      }
      const [dropped] = records.splice(index, 1);
      if (dropped?.endTick != null) {
        evictedThrough = Math.max(evictedThrough, dropped.endTick);
      }
    }
  }

  return {
    now: () => tick,
    begin(input) {
      tick += 1;
      const record: ActivityRecord = {
        root: input.root,
        kind: input.kind,
        ownerId: input.ownerId,
        fileKeys: input.fileKeys ?? [],
        startTick: tick,
        endTick: null,
      };
      records.push(record);
      evict();
      return {
        startTick: record.startTick,
        end(): void {
          if (record.endTick !== null) {
            return;
          }
          tick += 1;
          record.endTick = tick;
        },
      };
    },
    othersSince(input) {
      const fileWrites = new Set<string>();
      let exclusiveCount = 0;
      let shellCount = 0;
      for (const record of records) {
        if (record.endTick !== null && record.endTick <= input.fromTick) {
          continue;
        }
        if (input.ownerId !== undefined && record.ownerId === input.ownerId) {
          continue;
        }
        if (!workspaceRootsOverlap(record.root, input.root)) {
          continue;
        }
        if (record.kind === 'file-write') {
          for (const key of record.fileKeys) {
            if (input.fileKey === undefined || key === input.fileKey) {
              fileWrites.add(key);
            }
          }
        } else if (record.kind === 'exclusive') {
          exclusiveCount += 1;
        } else {
          shellCount += 1;
        }
      }
      return {
        complete: input.fromTick >= evictedThrough,
        fileWrites: [...fileWrites].sort(),
        exclusiveCount,
        shellCount,
      };
    },
    ownShellCountSince(input) {
      return records.filter(
        (record) =>
          record.kind === 'shell' &&
          record.ownerId === input.ownerId &&
          (record.endTick === null || record.endTick > input.fromTick) &&
          workspaceRootsOverlap(record.root, input.root),
      ).length;
    },
  };
}

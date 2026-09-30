/**
 * Before/after images for the files a shell command changed.
 *
 * Host tools record what they write. A command has no receipt, so undo used
 * to leave whatever it changed alone, and a command touching a file the turn
 * also edited made the whole turn un-undoable. This gives command changes the
 * same before/after bytes a Host write has:
 *
 * - Before the command: every path the workspace fingerprint lists as dirty is
 *   read into the object store (cached by size+mtime, so a path costs a read
 *   once per version). That is the "before" of any of those files the command
 *   then changes.
 * - After the command: each path that moved gets its "after" from disk. Its
 *   "before" is the snapshot above, or — when the file was clean, hence absent
 *   from the fingerprint — its `HEAD` blob (a file `HEAD` lacks did not exist).
 * - A file whose bytes ended up unchanged (a `touch`, a commit that only
 *   cleaned the file) yields nothing.
 *
 * Anything that cannot be imaged safely — a symlink, an oversized file, a path
 * dirty before the command but not snapshotted, a file `HEAD` may not mirror
 * byte for byte, or more changes than the caps allow — is returned as
 * `uncaptured`, and the caller keeps treating those as before: listed, left
 * alone by undo, and unsafe to undo if the turn also wrote them.
 */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES,
  findContentFilteredPaths,
  readHeadFiles,
  resolveTurnChangePath,
  type TurnChangeObjectStore,
  type TurnChangeWriteReceipt,
} from '@piwin/git';

import {
  MISSING_STAMP,
  stampOfStats,
  type WorkspaceFingerprint,
} from '../tools/workspace-fingerprint.js';

export type CommandCaptureLimits = {
  /**
   * Dirty paths read before a command; a larger dirty set stops being
   * snapshotted. A cold path costs ~3 ms (the object store fsyncs each new
   * object), paid once per file version, so this bounds the first command's wait.
   */
  maxSnapshotPaths: number;
  /** Bytes read into the store by one snapshot pass (later passes hit the cache). */
  maxSnapshotBytes: number;
  /** Changed paths one command may record; the rest stay uncaptured. */
  maxCapturedPaths: number;
  /** After + HEAD bytes one command may record. */
  maxCapturedBytes: number;
  /**
   * A cached snapshot object is unreferenced until a command changes the file,
   * and the retention sweep deletes unreferenced objects after a day. Re-read
   * well inside that window so a hit never points at a deleted object.
   */
  snapshotCacheTtlMs: number;
};

export const DEFAULT_COMMAND_CAPTURE_LIMITS: CommandCaptureLimits = {
  maxSnapshotPaths: 1_000,
  maxSnapshotBytes: 128 * 1024 * 1024,
  maxCapturedPaths: 500,
  maxCapturedBytes: 128 * 1024 * 1024,
  snapshotCacheTtlMs: 6 * 60 * 60 * 1000,
};

const READS_IN_FLIGHT = 8;

type FileImage = { exists: boolean; sha256: string | null };

export type CommandPreSnapshot = {
  /** Paths the command started with as dirty, whether or not they could be read. */
  readonly dirtyBefore: ReadonlySet<string>;
  /** Their bytes, for the paths that could be read. */
  readonly images: ReadonlyMap<string, FileImage>;
};

export type CommandChangeCapture = {
  receipts: TurnChangeWriteReceipt[];
  /** Changed paths with no usable before/after image. */
  uncaptured: string[];
};

export type CommandChangeCapturer = {
  /** Never throws; a failure just leaves fewer paths imaged. */
  snapshotBefore(input: {
    root: string;
    fingerprint: WorkspaceFingerprint;
  }): Promise<CommandPreSnapshot>;
  /** Never throws; a failure leaves the path in `uncaptured`. */
  captureChanges(input: {
    root: string;
    changedPaths: readonly string[];
    before: CommandPreSnapshot;
  }): Promise<CommandChangeCapture>;
};

type DiskRead =
  | { kind: 'file'; bytes: Uint8Array; stamp: string }
  | { kind: 'missing' }
  | { kind: 'unsupported' };

async function readFileImage(root: string, relativePath: string): Promise<DiskRead> {
  try {
    const resolved = await resolveTurnChangePath({ workspaceRoot: root, relativePath });
    if (resolved.kind === 'missing') return { kind: 'missing' };
    if (resolved.kind !== 'file') return { kind: 'unsupported' };
    const before = await lstat(resolved.absolutePath);
    if (before.size > DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES) return { kind: 'unsupported' };
    const bytes = new Uint8Array(await readFile(resolved.absolutePath));
    const after = await lstat(resolved.absolutePath);
    // Written while it was read: these bytes are not any one version of the file.
    if (stampOfStats(before) !== stampOfStats(after)) return { kind: 'unsupported' };
    return { kind: 'file', bytes, stamp: stampOfStats(after) };
  } catch {
    return { kind: 'unsupported' };
  }
}

async function inGroups<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += READS_IN_FLIGHT) {
    await Promise.all(items.slice(index, index + READS_IN_FLIGHT).map(run));
  }
}

export function createCommandChangeCapturer(options: {
  store: TurnChangeObjectStore;
  now?: () => number;
  limits?: Partial<CommandCaptureLimits>;
}): CommandChangeCapturer {
  const { store } = options;
  const now = options.now ?? Date.now;
  const limits = { ...DEFAULT_COMMAND_CAPTURE_LIMITS, ...options.limits };
  /** root → path → the version last stored for it. */
  const cache = new Map<string, Map<string, { stamp: string; sha256: string; storedAt: number }>>();

  const cacheFor = (root: string) => {
    let entries = cache.get(root);
    if (!entries) {
      entries = new Map();
      cache.set(root, entries);
    }
    return entries;
  };

  return {
    async snapshotBefore({ root, fingerprint }) {
      const dirtyBefore = new Set(fingerprint.keys());
      const images = new Map<string, FileImage>();
      const entries = cacheFor(root);
      try {
        const paths = [...fingerprint.keys()].sort().slice(0, limits.maxSnapshotPaths);
        let budget = limits.maxSnapshotBytes;
        await inGroups(paths, async (path) => {
          if (fingerprint.get(path) === MISSING_STAMP) {
            images.set(path, { exists: false, sha256: null });
            return;
          }
          const hit = entries.get(path);
          if (hit && now() - hit.storedAt < limits.snapshotCacheTtlMs) {
            try {
              // Compare with the disk now, not the fingerprint: it may be a moment old.
              const current = stampOfStats(await lstat(join(root, path)));
              if (current === hit.stamp) {
                images.set(path, { exists: true, sha256: hit.sha256 });
                return;
              }
            } catch {
              // Gone or unreadable: fall through and read it afresh.
            }
          }
          if (budget <= 0) return;
          const read = await readFileImage(root, path);
          if (read.kind === 'missing') {
            images.set(path, { exists: false, sha256: null });
            return;
          }
          if (read.kind !== 'file') return;
          budget -= read.bytes.byteLength;
          const { sha256 } = await store.put(read.bytes);
          entries.set(path, { stamp: read.stamp, sha256, storedAt: now() });
          images.set(path, { exists: true, sha256 });
        });
        for (const path of [...entries.keys()]) {
          if (!dirtyBefore.has(path)) entries.delete(path);
        }
      } catch (error) {
        console.warn('[host-runtime] before-command snapshot failed', error);
      }
      return { dirtyBefore, images };
    },

    async captureChanges({ root, changedPaths, before }) {
      const receipts: TurnChangeWriteReceipt[] = [];
      const uncaptured = new Set<string>();
      const candidates = [...new Set(changedPaths)].sort();
      const withinCap = candidates.slice(0, limits.maxCapturedPaths);
      for (const path of candidates.slice(limits.maxCapturedPaths)) uncaptured.add(path);

      const needHead: string[] = [];
      for (const path of withinCap) {
        if (before.images.has(path)) continue;
        if (before.dirtyBefore.has(path)) {
          // Dirty before the command yet never read: HEAD is not its "before".
          uncaptured.add(path);
        } else {
          needHead.push(path);
        }
      }

      let headFiles: Awaited<ReturnType<typeof readHeadFiles>> | undefined;
      let filtered: Set<string> | 'all' = new Set();
      if (needHead.length > 0) {
        try {
          headFiles = await readHeadFiles({
            cwd: root,
            relativePaths: needHead,
            maxBytes: DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES,
          });
          const inHead = needHead.filter((path) => headFiles?.found.has(path));
          if (inHead.length > 0) {
            filtered = await findContentFilteredPaths({ cwd: root, relativePaths: inHead });
          }
        } catch (error) {
          console.warn('[host-runtime] HEAD lookup for command changes failed', error);
          headFiles = undefined;
        }
      }

      let bytesLeft = limits.maxCapturedBytes;
      const perPath = new Map<string, TurnChangeWriteReceipt | 'same' | 'uncaptured'>();
      await inGroups(withinCap, async (path) => {
        if (uncaptured.has(path)) return;
        try {
          const knownBefore = before.images.get(path);
          let beforeImage: FileImage | undefined = knownBefore;
          if (beforeImage === undefined) {
            if (headFiles === undefined || filtered === 'all' || filtered.has(path)) {
              perPath.set(path, 'uncaptured');
              return;
            }
            const bytes = headFiles.found.get(path);
            if (bytes !== undefined) {
              if (bytes.byteLength > bytesLeft) {
                perPath.set(path, 'uncaptured');
                return;
              }
              bytesLeft -= bytes.byteLength;
              beforeImage = { exists: true, sha256: (await store.put(bytes)).sha256 };
            } else if (headFiles.absent.has(path)) {
              beforeImage = { exists: false, sha256: null };
            } else {
              perPath.set(path, 'uncaptured');
              return;
            }
          }
          const after = await readFileImage(root, path);
          if (after.kind === 'unsupported') {
            perPath.set(path, 'uncaptured');
            return;
          }
          let afterImage: FileImage;
          if (after.kind === 'missing') {
            afterImage = { exists: false, sha256: null };
          } else {
            if (after.bytes.byteLength > bytesLeft) {
              perPath.set(path, 'uncaptured');
              return;
            }
            bytesLeft -= after.bytes.byteLength;
            afterImage = { exists: true, sha256: (await store.put(after.bytes)).sha256 };
          }
          if (beforeImage.exists === afterImage.exists && beforeImage.sha256 === afterImage.sha256) {
            perPath.set(path, 'same');
            return;
          }
          perPath.set(path, {
            relativePath: path,
            beforeSha: beforeImage.sha256,
            afterSha: afterImage.sha256,
            beforeExists: beforeImage.exists,
            afterExists: afterImage.exists,
          });
        } catch (error) {
          console.warn(`[host-runtime] could not image command change ${path}`, error);
          perPath.set(path, 'uncaptured');
        }
      });
      for (const path of withinCap) {
        const outcome = perPath.get(path);
        if (outcome === undefined || outcome === 'uncaptured') {
          uncaptured.add(path);
        } else if (outcome !== 'same') {
          receipts.push(outcome);
        }
      }
      return { receipts, uncaptured: [...uncaptured].sort() };
    },
  };
}

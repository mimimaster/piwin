/**
 * Freeze a child worktree against its create-time base commit (S0), not parent HEAD.
 * S1 is the live worktree. Result objects stay in the CAS after the copy is gone.
 *
 * Only paths Git reports as changed (tracked diff vs base + untracked, non-ignored)
 * are read, so installed dependencies and build output never enter the CAS.
 * Files over the object limit, symlinks and other non-regular entries are omitted
 * and mark coverage incomplete: the CAS only models regular file bytes.
 */
import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { composeFileActions, type ComposedFileAction, type ComposeCoverage } from './compose.js';
import { DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES } from './object-store.js';
import { runGitCommand } from '../git-command-runner.js';
import { assertSafeRef } from '../path-safety.js';

type FreezeObjectStore = {
  put?(bytes: Uint8Array): Promise<{ sha256: string }>;
  putObject?(bytes: Uint8Array): Promise<{ sha256: string }>;
};

const execFileAsync = promisify(execFile);
const MAX_BLOB_BYTES = DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES;
const PATH_LIST_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const PATH_LIST_TIMEOUT_MS = 60_000;

export type FrozenWorktreeSnapshot = {
  coverage: ComposeCoverage;
  files: readonly ComposedFileAction[];
  baseCommit: string;
};

type Side = { kind: 'absent' } | { kind: 'bytes'; bytes: Uint8Array } | { kind: 'omitted' };

export async function freezeWorktreeAgainstBase(input: {
  worktreePath: string;
  baseCommit: string;
  store: FreezeObjectStore;
}): Promise<FrozenWorktreeSnapshot> {
  const baseCommit = assertSafeRef(input.baseCommit);
  const changedPaths = await listChangedPaths(input.worktreePath, baseCommit);
  const baseline = await listBaselineBlobs(input.worktreePath, baseCommit);
  const actions: ComposedFileAction[] = [];
  let coverage: ComposeCoverage = 'complete';

  for (const relativePath of [...changedPaths].sort()) {
    const before = await readBaselineSide(input.worktreePath, baseline.get(relativePath));
    const after = await readLiveSide(input.worktreePath, relativePath);
    if (before.kind === 'omitted' || after.kind === 'omitted') {
      coverage = 'incomplete';
      continue;
    }
    const beforeSha =
      before.kind === 'bytes' ? (await putBytes(input.store, before.bytes)).sha256 : null;
    const afterSha =
      after.kind === 'bytes' ? (await putBytes(input.store, after.bytes)).sha256 : null;
    actions.push({
      relativePath,
      beforeSha,
      afterSha,
      beforeExists: before.kind === 'bytes',
      afterExists: after.kind === 'bytes',
    });
  }

  const composed = composeFileActions(actions);
  return {
    coverage: coverage === 'incomplete' ? 'incomplete' : composed.coverage,
    files: composed.files,
    baseCommit,
  };
}

async function listChangedPaths(worktreePath: string, baseCommit: string): Promise<Set<string>> {
  // Working tree (including any child commits) vs base; renames split into delete + add.
  const tracked = await runGitCommand({
    cwd: worktreePath,
    args: ['diff', '--name-only', '--no-renames', '-z', baseCommit, '--'],
    maxBufferBytes: PATH_LIST_MAX_BUFFER_BYTES,
    timeoutMs: PATH_LIST_TIMEOUT_MS,
  });
  const untracked = await runGitCommand({
    cwd: worktreePath,
    args: ['ls-files', '--others', '--exclude-standard', '-z'],
    maxBufferBytes: PATH_LIST_MAX_BUFFER_BYTES,
    timeoutMs: PATH_LIST_TIMEOUT_MS,
  });
  const paths = new Set<string>();
  for (const output of [tracked.stdout, untracked.stdout]) {
    for (const path of output.split('\0')) {
      if (path) paths.add(path);
    }
  }
  return paths;
}

type BaselineBlob = { sha: string; size: number; symlink: boolean };

async function listBaselineBlobs(
  worktreePath: string,
  baseCommit: string,
): Promise<Map<string, BaselineBlob>> {
  const listed = await runGitCommand({
    cwd: worktreePath,
    args: ['ls-tree', '-r', '-z', '--long', '--full-tree', baseCommit],
    maxBufferBytes: PATH_LIST_MAX_BUFFER_BYTES,
    timeoutMs: PATH_LIST_TIMEOUT_MS,
  });
  const blobs = new Map<string, BaselineBlob>();
  for (const entry of parseLsTreeLong(listed.stdout)) {
    if (entry.kind !== 'blob') continue;
    blobs.set(entry.path, { sha: entry.sha, size: entry.size, symlink: entry.mode === '120000' });
  }
  return blobs;
}

async function readBaselineSide(
  worktreePath: string,
  blob: BaselineBlob | undefined,
): Promise<Side> {
  if (!blob) return { kind: 'absent' };
  if (blob.symlink || blob.size > MAX_BLOB_BYTES) return { kind: 'omitted' };
  return { kind: 'bytes', bytes: await catBlob(worktreePath, blob.sha) };
}

async function readLiveSide(worktreePath: string, relativePath: string): Promise<Side> {
  const absolutePath = join(worktreePath, relativePath);
  const meta = await lstat(absolutePath).catch((error: unknown) => {
    if (isNotFound(error)) return undefined;
    throw error;
  });
  if (!meta) return { kind: 'absent' };
  // A symlink or gitlink directory is not a deletion; it just is not representable.
  if (!meta.isFile() || meta.size > MAX_BLOB_BYTES) return { kind: 'omitted' };
  const bytes = new Uint8Array(await readFile(absolutePath));
  if (bytes.byteLength > MAX_BLOB_BYTES) return { kind: 'omitted' };
  return { kind: 'bytes', bytes };
}

type LsTreeLongEntry = { mode: string; kind: string; sha: string; size: number; path: string };

function parseLsTreeLong(stdout: string): LsTreeLongEntry[] {
  const entries: LsTreeLongEntry[] = [];
  for (const record of stdout.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    // "<mode> <type> <object> <padded size or ->"
    const [mode, kind, sha, size] = record.slice(0, tab).trim().split(/\s+/);
    const path = record.slice(tab + 1);
    if (!mode || !kind || !sha || !size || !path) continue;
    entries.push({ mode, kind, sha, size: size === '-' ? 0 : Number(size), path });
  }
  return entries;
}

async function putBytes(
  store: FreezeObjectStore,
  bytes: Uint8Array,
): Promise<{ sha256: string }> {
  if (typeof store.putObject === 'function') {
    return store.putObject(bytes);
  }
  if (typeof store.put === 'function') {
    return store.put(bytes);
  }
  throw new Error('freeze store cannot put objects');
}

async function catBlob(worktreePath: string, sha: string): Promise<Uint8Array> {
  const { stdout } = await execFileAsync('git', ['cat-file', 'blob', sha], {
    cwd: worktreePath,
    encoding: 'buffer',
    maxBuffer: MAX_BLOB_BYTES,
    timeout: 15_000,
  });
  return new Uint8Array(stdout);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/**
 * Freeze a child worktree against its create-time base commit (S0), not parent HEAD.
 * S1 is the live worktree. Result objects stay in the CAS after the copy is gone.
 */
import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { composeFileActions, type ComposedFileAction, type ComposeCoverage } from './compose.js';
import { runGitCommand } from '../git-command-runner.js';
import { assertSafeRef } from '../path-safety.js';

type FreezeObjectStore = {
  put?(bytes: Uint8Array): Promise<{ sha256: string }>;
  putObject?(bytes: Uint8Array): Promise<{ sha256: string }>;
};

const execFileAsync = promisify(execFile);
const MAX_BLOB_BYTES = 20 * 1024 * 1024;

export type FrozenWorktreeSnapshot = {
  coverage: ComposeCoverage;
  files: readonly ComposedFileAction[];
  baseCommit: string;
};

export async function freezeWorktreeAgainstBase(input: {
  worktreePath: string;
  baseCommit: string;
  store: FreezeObjectStore;
}): Promise<FrozenWorktreeSnapshot> {
  const baseCommit = assertSafeRef(input.baseCommit);
  const baseline = await loadBaselineBlobs(input.worktreePath, baseCommit);
  const live = await loadLiveBlobs(input.worktreePath);
  const paths = new Set([...baseline.keys(), ...live.keys()]);
  const actions: ComposedFileAction[] = [];

  for (const relativePath of [...paths].sort()) {
    const beforeBytes = baseline.get(relativePath);
    const afterBytes = live.get(relativePath);
    const beforeSha = beforeBytes ? (await putBytes(input.store, beforeBytes)).sha256 : null;
    const afterSha = afterBytes ? (await putBytes(input.store, afterBytes)).sha256 : null;
    actions.push({
      relativePath,
      beforeSha,
      afterSha,
      beforeExists: beforeBytes !== undefined,
      afterExists: afterBytes !== undefined,
    });
  }

  const composed = composeFileActions(actions);
  return {
    coverage: composed.coverage,
    files: composed.files,
    baseCommit,
  };
}

async function loadBaselineBlobs(
  worktreePath: string,
  baseCommit: string,
): Promise<Map<string, Uint8Array>> {
  const listed = await runGitCommand({
    cwd: worktreePath,
    args: ['ls-tree', '-r', '-z', '--full-tree', baseCommit],
  });
  const blobs = new Map<string, Uint8Array>();
  for (const entry of parseLsTree(listed.stdout)) {
    if (entry.kind !== 'blob') continue;
    blobs.set(entry.path, await catBlob(worktreePath, entry.sha));
  }
  return blobs;
}

async function loadLiveBlobs(worktreePath: string): Promise<Map<string, Uint8Array>> {
  const blobs = new Map<string, Uint8Array>();
  await walkFiles(worktreePath, '', blobs);
  return blobs;
}

async function walkFiles(
  root: string,
  relativeDir: string,
  blobs: Map<string, Uint8Array>,
): Promise<void> {
  const absoluteDir = relativeDir ? join(root, relativeDir) : root;
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = join(root, relativePath);
    if (entry.isDirectory()) {
      await walkFiles(root, relativePath, blobs);
      continue;
    }
    const meta = await lstat(absolutePath);
    if (!meta.isFile()) continue;
    blobs.set(relativePath, new Uint8Array(await readFile(absolutePath)));
  }
}

type LsTreeEntry = { kind: string; sha: string; path: string };

function parseLsTree(stdout: string): LsTreeEntry[] {
  const entries: LsTreeEntry[] = [];
  for (const record of stdout.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const meta = record.slice(0, tab);
    const path = record.slice(tab + 1);
    const parts = meta.split(' ');
    const kind = parts[1];
    const sha = parts[2];
    if (!kind || !sha || !path) continue;
    entries.push({ kind, sha, path });
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

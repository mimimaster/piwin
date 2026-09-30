/**
 * Repair for an undo/redo stuck at `needs-repair` (its automatic rollback
 * could not finish). Preview classifies each path; run restores only paths
 * that still hold what the operation wrote; verify clears the block once
 * every path is back to its pre-operation bytes. Content that changed from
 * elsewhere is never overwritten.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { deleteTurnChangeFile, writeTurnChangeFile } from './file-writer.js';
import type { TurnChangeObjectStore } from './object-store.js';
import type { TurnChangeOperationFileRecord } from './operation-store.js';
import { assertWritableTurnChangeFile } from './path-policy.js';
import type { TurnChangeStore } from './store.js';

export type TurnChangeRepairState = 'restored' | 'operation-content' | 'foreign';

export type TurnChangeRepairFile = { relativePath: string; state: TurnChangeRepairState };

export type TurnChangeRepairPreviewResult = {
  files: TurnChangeRepairFile[];
  /** Binds a run to the file states this preview saw. */
  confirmationToken: string;
};

type Current = { exists: false } | { exists: true; sha256: string } | { exists: 'unreadable' };

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readCurrent(workspaceRoot: string, relativePath: string): Promise<Current> {
  try {
    const resolved = await assertWritableTurnChangeFile({ workspaceRoot, relativePath });
    if (resolved.kind === 'missing') return { exists: false };
    if (resolved.kind !== 'file') return { exists: 'unreadable' };
    return { exists: true, sha256: sha256Hex(new Uint8Array(await readFile(resolved.absolutePath))) };
  } catch {
    return { exists: 'unreadable' };
  }
}

function matches(current: Current, exists: boolean, sha: string | null): boolean {
  if (current.exists === 'unreadable') return false;
  if (!exists) return current.exists === false;
  return current.exists === true && sha !== null && current.sha256 === sha;
}

function classify(current: Current, file: TurnChangeOperationFileRecord): TurnChangeRepairState {
  if (matches(current, file.fromExists, file.backupSha ?? file.fromSha)) return 'restored';
  if (matches(current, file.toExists, file.toSha)) return 'operation-content';
  return 'foreign';
}

async function classifyAll(
  workspaceRoot: string,
  files: readonly TurnChangeOperationFileRecord[],
): Promise<{ files: TurnChangeRepairFile[]; fingerprint: string }> {
  const hash = createHash('sha256');
  const classified: TurnChangeRepairFile[] = [];
  for (const file of files) {
    const current = await readCurrent(workspaceRoot, file.relativePath);
    const state = classify(current, file);
    classified.push({ relativePath: file.relativePath, state });
    const currentKey =
      current.exists === true ? current.sha256 : current.exists === false ? 'absent' : 'unreadable';
    hash.update(`${file.relativePath}\0${state}\0${currentKey}\n`);
  }
  return { files: classified, fingerprint: hash.digest('hex') };
}

export async function previewTurnChangeRepair(input: {
  workspaceRoot: string;
  store: TurnChangeStore;
  operationId: string;
}): Promise<TurnChangeRepairPreviewResult> {
  const files = input.store.listOperationFiles(input.operationId);
  const classified = await classifyAll(input.workspaceRoot, files);
  return {
    files: classified.files,
    confirmationToken: `${input.operationId}:${classified.fingerprint}`,
  };
}

export type TurnChangeRepairRunResult =
  | { outcome: 'restored'; files: TurnChangeRepairFile[] }
  | { outcome: 'stale-preview' }
  /** Some paths hold content from elsewhere and were left alone. */
  | { outcome: 'foreign-content'; files: TurnChangeRepairFile[] };

export async function runTurnChangeRepair(input: {
  workspaceRoot: string;
  store: TurnChangeStore;
  objectStore: TurnChangeObjectStore;
  operationId: string;
  confirmationToken: string;
}): Promise<TurnChangeRepairRunResult> {
  const files = input.store.listOperationFiles(input.operationId);
  const before = await classifyAll(input.workspaceRoot, files);
  if (`${input.operationId}:${before.fingerprint}` !== input.confirmationToken) {
    return { outcome: 'stale-preview' };
  }
  for (const [index, file] of files.entries()) {
    if (before.files[index]?.state !== 'operation-content') continue;
    await restoreBackup(input.workspaceRoot, input.objectStore, file);
    input.store.updateOperationFileStatus(input.operationId, file.relativePath, 'rolled-back');
  }
  const after = await classifyAll(input.workspaceRoot, files);
  return after.files.some((file) => file.state !== 'restored')
    ? { outcome: 'foreign-content', files: after.files }
    : { outcome: 'restored', files: after.files };
}

/** True when every path is back to its pre-operation bytes; then the block lifts. */
export async function verifyTurnChangeRepair(input: {
  workspaceRoot: string;
  store: TurnChangeStore;
  operationId: string;
}): Promise<{ verified: boolean; files: TurnChangeRepairFile[] }> {
  const classified = await classifyAll(
    input.workspaceRoot,
    input.store.listOperationFiles(input.operationId),
  );
  const verified = classified.files.every((file) => file.state === 'restored');
  if (verified) {
    input.store.updateOperationStatus(input.operationId, 'rolled-back');
    input.store.noteOperationUpdate(input.operationId, 'repaired');
  }
  return { verified, files: classified.files };
}

async function restoreBackup(
  workspaceRoot: string,
  objectStore: TurnChangeObjectStore,
  file: TurnChangeOperationFileRecord,
): Promise<void> {
  if (!file.fromExists) {
    await deleteTurnChangeFile({ workspaceRoot, relativePath: file.relativePath, store: objectStore });
    return;
  }
  const sha = file.backupSha ?? file.fromSha;
  if (sha === null) throw new Error(`missing backup for ${file.relativePath}`);
  await writeTurnChangeFile({
    workspaceRoot,
    relativePath: file.relativePath,
    bytes: await objectStore.get(sha),
    store: objectStore,
  });
}

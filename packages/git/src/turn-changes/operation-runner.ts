/**
 * Idempotent undo/redo/subagent-apply runner on the bounded writer. Prechecks
 * every path before the first write. Does not change git HEAD or index.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { deleteTurnChangeFile, writeTurnChangeFile } from './file-writer.js';
import type { TurnChangeObjectStore } from './object-store.js';
import type { PlannedFileOp } from './operation-plan.js';
import type { TurnChangeOperationKind } from './operation-store.js';
import { assertWritableTurnChangeFile } from './path-policy.js';
import type { TurnChangeStore } from './store.js';

export type TurnChangeOperationRunResult = {
  operationId: string;
  status: string;
  replayed: boolean;
  reason?: 'files-changed' | 'already-applied' | 'candidate-group-selected' | 'needs-repair';
  affectedPaths?: string[];
};

export async function runTurnChangeOperation(input: {
  workspaceRoot: string;
  store: TurnChangeStore;
  objectStore: TurnChangeObjectStore;
  principal: string;
  idempotencyKey: string;
  requestHash: string;
  changeSetId: string;
  kind: TurnChangeOperationKind;
  expectedRevision: number;
  files: readonly PlannedFileOp[];
  resultId?: string;
  candidateGroupId?: string | null;
}): Promise<TurnChangeOperationRunResult> {
  const begun = beginRun(input);
  if (begun.outcome === 'replay') {
    return replayResult(input.store, begun.operationId);
  }
  if (begun.outcome === 'conflict') {
    return {
      operationId: begun.operationId,
      status: begun.code,
      replayed: false,
      reason: begun.code,
    };
  }

  const operationId = begun.operationId;
  const affectedPaths = await collectMismatchedPaths(input.workspaceRoot, input.files);
  if (affectedPaths.length > 0) {
    if (input.kind === 'subagent-apply') {
      input.store.releaseSubagentApplyReservation(operationId);
    } else {
      input.store.updateOperationStatus(operationId, 'rejected');
    }
    return {
      operationId,
      status: 'rejected',
      replayed: false,
      reason: 'files-changed',
      affectedPaths,
    };
  }

  try {
    input.store.recordOperationFiles(
      input.files.map((file) => ({
        operationId,
        relativePath: file.relativePath,
        fromSha: file.fromSha,
        toSha: file.toSha,
        backupSha: file.fromSha,
        fromExists: file.fromExists,
        toExists: file.toExists,
        status: 'intent',
      })),
    );

    for (const file of input.files) {
      await applyPlannedFile(input.workspaceRoot, input.objectStore, file);
      input.store.updateOperationFileStatus(operationId, file.relativePath, 'applied');
      await verifyPlannedFile(input.workspaceRoot, file);
      input.store.updateOperationFileStatus(operationId, file.relativePath, 'verified');
    }

    input.store.updateOperationStatus(operationId, 'succeeded');
    if (input.kind !== 'subagent-apply') {
      input.store.markAttemptDisposition(
        input.changeSetId,
        input.kind === 'undo' ? 'undone' : 'applied',
      );
    }
    return { operationId, status: 'succeeded', replayed: false };
  } catch (error) {
    if (input.kind === 'subagent-apply') {
      input.store.updateOperationStatus(operationId, 'needs-repair');
    }
    throw error;
  }
}

function beginRun(input: {
  store: TurnChangeStore;
  changeSetId: string;
  kind: TurnChangeOperationKind;
  expectedRevision: number;
  principal: string;
  idempotencyKey: string;
  requestHash: string;
  resultId?: string;
  candidateGroupId?: string | null;
}):
  | { outcome: 'created'; operationId: string }
  | { outcome: 'replay'; operationId: string }
  | {
      outcome: 'conflict';
      operationId: string;
      code: 'already-applied' | 'candidate-group-selected' | 'needs-repair';
    } {
  if (input.kind === 'subagent-apply') {
    const resultId = input.resultId;
    if (!resultId) {
      throw new Error('subagent-apply requires resultId');
    }
    return input.store.reserveSubagentApply({
      operationId: randomUUID(),
      changeSetId: input.changeSetId,
      expectedRevision: input.expectedRevision,
      principal: input.principal,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      resultId,
      ...(input.candidateGroupId !== undefined ? { candidateGroupId: input.candidateGroupId } : {}),
    });
  }
  return input.store.beginOperation({
    operationId: randomUUID(),
    changeSetId: input.changeSetId,
    kind: input.kind,
    expectedRevision: input.expectedRevision,
    principal: input.principal,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
  });
}

function replayResult(store: TurnChangeStore, operationId: string): TurnChangeOperationRunResult {
  const existing = store.getOperation(operationId);
  if (existing === undefined) {
    throw new Error('idempotent operation missing');
  }
  return { operationId, status: existing.status, replayed: true };
}

async function collectMismatchedPaths(
  workspaceRoot: string,
  files: readonly PlannedFileOp[],
): Promise<string[]> {
  const affectedPaths: string[] = [];
  for (const file of files) {
    if (await pathMismatchesFromSha(workspaceRoot, file)) {
      affectedPaths.push(file.relativePath);
    }
  }
  return affectedPaths;
}

async function pathMismatchesFromSha(workspaceRoot: string, file: PlannedFileOp): Promise<boolean> {
  try {
    const resolved = await assertWritableTurnChangeFile({
      workspaceRoot,
      relativePath: file.relativePath,
    });
    if (resolved.kind === 'missing') {
      return file.fromExists || file.fromSha !== null;
    }
    if (!file.fromExists || file.fromSha === null) {
      return true;
    }
    const bytes = new Uint8Array(await readFile(resolved.absolutePath));
    return sha256Hex(bytes) !== file.fromSha;
  } catch {
    return true;
  }
}

async function applyPlannedFile(
  workspaceRoot: string,
  objectStore: TurnChangeObjectStore,
  file: PlannedFileOp,
): Promise<void> {
  if (file.toExists) {
    if (file.toSha === null) {
      throw new Error(`toExists requires toSha for ${file.relativePath}`);
    }
    const bytes = await objectStore.get(file.toSha);
    await writeTurnChangeFile({
      workspaceRoot,
      relativePath: file.relativePath,
      bytes,
      store: objectStore,
    });
    return;
  }
  await deleteTurnChangeFile({
    workspaceRoot,
    relativePath: file.relativePath,
    store: objectStore,
  });
}

async function verifyPlannedFile(workspaceRoot: string, file: PlannedFileOp): Promise<void> {
  const resolved = await assertWritableTurnChangeFile({
    workspaceRoot,
    relativePath: file.relativePath,
  });
  if (!file.toExists) {
    if (resolved.kind !== 'missing') {
      throw new Error(`verify failed: ${file.relativePath} still exists`);
    }
    return;
  }
  if (resolved.kind !== 'file' || file.toSha === null) {
    throw new Error(`verify failed: ${file.relativePath}`);
  }
  const bytes = new Uint8Array(await readFile(resolved.absolutePath));
  if (sha256Hex(bytes) !== file.toSha) {
    throw new Error(`verify failed: ${file.relativePath} toSha mismatch`);
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

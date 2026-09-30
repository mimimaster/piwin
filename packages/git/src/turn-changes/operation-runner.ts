/**
 * Idempotent undo/redo/subagent-apply runner on the bounded writer. Prechecks
 * every path before the first write (`precheck.ts`). Does not change git HEAD
 * or index.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { deleteTurnChangeFile, writeTurnChangeFile } from './file-writer.js';
import type { TurnChangeObjectStore } from './object-store.js';
import type { PlannedFileOp } from './operation-plan.js';
import type { TurnChangeOperationKind } from './operation-store.js';
import { assertWritableTurnChangeFile } from './path-policy.js';
import { precheckTurnChangeOperation, type TurnChangePrecheckReason } from './precheck.js';
import { recoverTurnChangeOperation } from './recovery.js';
import type { TurnChangeStore } from './store.js';

export type TurnChangeOperationRunResult = {
  operationId: string;
  status: string;
  replayed: boolean;
  reason?:
    | TurnChangePrecheckReason
    | 'already-applied'
    | 'candidate-group-selected'
    | 'needs-repair'
    | 'cancelled'
    | 'write-failed';
  affectedPaths?: string[];
  /** Undo: command-created files that changed after the turn and were left alone. */
  skippedPaths?: string[];
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
  /** Undo/redo: the workspace for the operation record (`turn-changes/operations`). */
  workspaceId?: string;
  /** Called once the operation is recorded, before any file is read or written. */
  onOperationStarted?: (operationId: string) => void;
  /** Called after each file is written and verified (`done` of `total`). */
  onProgress?: (operationId: string, done: number, total: number) => void;
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
  const userFacing = input.kind !== 'subagent-apply';
  if (userFacing && input.workspaceId !== undefined) {
    input.store.recordOperationStart({ operationId, workspaceId: input.workspaceId });
  }
  input.onOperationStarted?.(operationId);
  const finish = (status: string, reason: string | null = null): void => {
    input.store.updateOperationStatus(operationId, status);
    if (userFacing) input.store.noteOperationUpdate(operationId, reason);
  };
  const precheck = await precheckTurnChangeOperation({
    workspaceRoot: input.workspaceRoot,
    files: input.files,
    objectStore: input.objectStore,
  });
  if (!precheck.ok) {
    if (input.kind === 'subagent-apply') {
      input.store.releaseSubagentApplyReservation(operationId);
    } else {
      finish('rejected', precheck.reason);
    }
    return {
      operationId,
      status: 'rejected',
      replayed: false,
      reason: precheck.reason,
      affectedPaths: precheck.affectedPaths,
    };
  }
  // Files the precheck said to leave alone (changed or already gone) are out
  // of the operation: nothing is written, backed up or verified for them.
  const skipped = precheck.skipped ?? [];
  const omitted = new Set([...skipped, ...(precheck.gone ?? [])]);
  const files = omitted.size === 0 ? input.files : input.files.filter((file) => !omitted.has(file.relativePath));
  if (files.length === 0 && skipped.length > 0) {
    // Everything the turn changed has moved since: nothing is left to undo.
    if (input.kind === 'subagent-apply') {
      input.store.releaseSubagentApplyReservation(operationId);
    } else {
      finish('rejected', 'files-changed');
    }
    return {
      operationId,
      status: 'rejected',
      replayed: false,
      reason: 'files-changed',
      affectedPaths: skipped,
    };
  }
  // Last point a cancel is honored: nothing has been written yet.
  if (userFacing && input.store.isOperationCancelRequested(operationId)) {
    finish('cancelled', 'cancelled');
    return { operationId, status: 'cancelled', replayed: false, reason: 'cancelled' };
  }

  try {
    if (userFacing && skipped.length > 0) {
      input.store.recordOperationSkipped(operationId, skipped);
    }
    input.store.recordOperationFiles(
      files.map((file) => ({
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

    let done = 0;
    for (const file of files) {
      await applyPlannedFile(input.workspaceRoot, input.objectStore, file);
      input.store.updateOperationFileStatus(operationId, file.relativePath, 'applied');
      await verifyPlannedFile(input.workspaceRoot, file);
      input.store.updateOperationFileStatus(operationId, file.relativePath, 'verified');
      done += 1;
      input.onProgress?.(operationId, done, files.length);
    }

    finish('succeeded');
    if (input.kind !== 'subagent-apply') {
      input.store.markAttemptDisposition(
        input.changeSetId,
        input.kind === 'undo' ? 'undone' : 'applied',
      );
    }
    return {
      operationId,
      status: 'succeeded',
      replayed: false,
      ...(skipped.length > 0 ? { skippedPaths: [...skipped] } : {}),
    };
  } catch (error) {
    if (input.kind === 'subagent-apply') {
      input.store.updateOperationStatus(operationId, 'needs-repair');
      throw error;
    }
    // Put back what was already written from the per-file backups. If even
    // that fails, stop at needs-repair: the repair commands finish it and
    // nothing silently accepts new writes over a half-applied turn.
    const status = await rollBackAfterFailure(input, operationId);
    input.store.noteOperationUpdate(operationId, 'write-failed');
    console.warn(`[turn-changes] ${input.kind} ${operationId} failed mid-write (${status})`, error);
    return {
      operationId,
      status,
      replayed: false,
      reason: status === 'needs-repair' ? 'needs-repair' : 'write-failed',
    };
  }
}

async function rollBackAfterFailure(
  input: { workspaceRoot: string; store: TurnChangeStore; objectStore: TurnChangeObjectStore },
  operationId: string,
): Promise<string> {
  try {
    const recovered = await recoverTurnChangeOperation({
      workspaceRoot: input.workspaceRoot,
      store: input.store,
      objectStore: input.objectStore,
      operationId,
    });
    return recovered.status;
  } catch (error) {
    console.warn(`[turn-changes] rollback of ${operationId} failed`, error);
    input.store.updateOperationStatus(operationId, 'needs-repair');
    return 'needs-repair';
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

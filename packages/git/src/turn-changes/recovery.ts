/**
 * Roll back a mid-apply turn-change operation from per-path backups.
 * Does not change git HEAD or index.
 */
import { deleteTurnChangeFile, writeTurnChangeFile } from './file-writer.js';
import type { TurnChangeObjectStore } from './object-store.js';
import type { TurnChangeOperationFileRecord } from './operation-store.js';
import { assertWritableTurnChangeFile } from './path-policy.js';
import type { TurnChangeStore } from './store.js';

export async function recoverTurnChangeOperation(input: {
  workspaceRoot: string;
  store: TurnChangeStore;
  objectStore: TurnChangeObjectStore;
  operationId: string;
}): Promise<{ operationId: string; status: string }> {
  const operation = input.store.getOperation(input.operationId);
  if (operation === undefined) {
    throw new Error('operation not found');
  }
  if (operation.status !== 'applying') {
    return { operationId: input.operationId, status: operation.status };
  }

  const files = input.store.listOperationFiles(input.operationId);
  if (files.length > 0 && files.every((file) => file.status === 'verified')) {
    input.store.updateOperationStatus(input.operationId, 'succeeded');
    input.store.markAttemptDisposition(
      operation.changeSetId,
      operation.kind === 'undo' ? 'undone' : 'applied',
    );
    return { operationId: input.operationId, status: 'succeeded' };
  }

  for (const file of files) {
    if (file.status !== 'applied' && file.status !== 'verified') {
      continue;
    }
    await restoreFromBackup(input.workspaceRoot, input.objectStore, file);
    input.store.updateOperationFileStatus(input.operationId, file.relativePath, 'rolled-back');
  }

  input.store.updateOperationStatus(input.operationId, 'rolled-back');
  return { operationId: input.operationId, status: 'rolled-back' };
}

async function restoreFromBackup(
  workspaceRoot: string,
  objectStore: TurnChangeObjectStore,
  file: TurnChangeOperationFileRecord,
): Promise<void> {
  if (file.fromExists) {
    const sha = file.backupSha ?? file.fromSha;
    if (sha === null) {
      throw new Error(`missing backup for ${file.relativePath}`);
    }
    const bytes = await objectStore.get(sha);
    await writeTurnChangeFile({
      workspaceRoot,
      relativePath: file.relativePath,
      bytes,
      store: objectStore,
    });
    return;
  }

  const resolved = await assertWritableTurnChangeFile({
    workspaceRoot,
    relativePath: file.relativePath,
  });
  if (resolved.kind === 'file') {
    await deleteTurnChangeFile({
      workspaceRoot,
      relativePath: file.relativePath,
      store: objectStore,
    });
  }
}

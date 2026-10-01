/**
 * `turn-changes/export-backup`: copy one undo/redo's pre-operation backup to
 * a new directory on the Host machine (repair detail's 导出备份). Read-only
 * for the workspace; see @piwin/git export-backup.ts for the refusal rules.
 */
import type { HostCommand, HostResponse, TurnChangeBackupExport } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { exportTurnChangeBackup, TurnChangeBackupExportError } from '@piwin/git';

import { fail, ok } from '../response-helpers.js';
import type { TurnChangeRuntime } from '../turn-changes/runtime-wiring.js';

type ExportCommand = Extract<HostCommand, { type: 'turn-changes/export-backup' }>;

export async function handleTurnChangeExportBackup(
  command: ExportCommand,
  requestId: string | undefined,
  runtime: TurnChangeRuntime,
): Promise<HostResponse> {
  const operation = runtime.store.getOperation(command.operationId);
  if (!operation || (operation.kind !== 'undo' && operation.kind !== 'redo')) {
    return fail(requestId, command.type, 'operation not found', { code: 'not-found' });
  }
  const attempt = runtime.store.getAttempt(operation.changeSetId);
  const workspace = attempt ? runtime.store.getWorkspace(attempt.workspaceId) : undefined;
  if (!workspace) {
    return fail(requestId, command.type, 'workspace not registered', { code: 'unsupported-workspace' });
  }
  const files = runtime.store.listOperationFiles(command.operationId);
  if (files.length === 0) {
    // A pre-check rejection wrote nothing and kept no backup.
    return fail(requestId, command.type, 'operation has no backup', { code: 'backup-missing' });
  }
  try {
    const exported = await exportTurnChangeBackup({
      operationId: command.operationId,
      files,
      objectStore: runtime.objectStore,
      workspaceRoot: workspace.rootPath,
      destination: command.destination,
    });
    const body: TurnChangeBackupExport = { operationId: command.operationId, ...exported };
    return ok(requestId, command.type, body);
  } catch (error) {
    if (error instanceof TurnChangeBackupExportError) {
      return fail(requestId, command.type, error.message, { code: error.code });
    }
    return fail(requestId, command.type, `export failed: ${formatError(error)}`, { code: 'export-failed' });
  }
}

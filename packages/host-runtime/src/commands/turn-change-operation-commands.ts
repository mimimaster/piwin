/**
 * The undo/redo record and its exceptional paths: the workspace's operation
 * list (代码撤销记录), cancel before the first write, and repair of an
 * operation stuck at `needs-repair` (preview → run → verify).
 *
 * Repair only restores paths that still hold what the operation wrote;
 * anything changed from elsewhere is reported, never overwritten.
 */
import type {
  HostCommand,
  HostResponse,
  TurnChangeDirection,
  TurnChangeOperationEntry,
  TurnChangeOperationPage,
  TurnChangeOperationStatus,
  TurnChangeRepairPreview,
} from '@piwin/contracts';
import {
  previewTurnChangeRepair,
  runTurnChangeRepair,
  verifyTurnChangeRepair,
  type TurnChangeOperationLogRow,
} from '@piwin/git';
import { fail, ok } from '../response-helpers.js';
import { workspaceIdForRoot } from '../turn-changes/coordinator.js';
import type { TurnChangeRuntime } from '../turn-changes/runtime-wiring.js';
import { buildTurnChangeSummary } from '../turn-changes/turn-summary.js';

const DEFAULT_OPERATION_PAGE = 50;
const MAX_OPERATION_PAGE = 200;

const OPERATION_STATUSES = new Set<TurnChangeOperationStatus>([
  'applying',
  'succeeded',
  'rejected',
  'cancelled',
  'rolled-back',
  'needs-repair',
]);

export function toOperationStatus(value: string): TurnChangeOperationStatus {
  return OPERATION_STATUSES.has(value as TurnChangeOperationStatus)
    ? (value as TurnChangeOperationStatus)
    : 'rejected';
}

type OperationCommand = Extract<
  HostCommand,
  {
    type:
      | 'turn-changes/operation'
      | 'turn-changes/operations'
      | 'turn-changes/cancel'
      | 'turn-changes/recovery-preview'
      | 'turn-changes/recovery-run'
      | 'turn-changes/recovery-verify';
  }
>;

export function isTurnChangeOperationCommand(command: HostCommand): command is OperationCommand {
  return (
    command.type === 'turn-changes/operation' ||
    command.type === 'turn-changes/operations' ||
    command.type === 'turn-changes/cancel' ||
    command.type === 'turn-changes/recovery-preview' ||
    command.type === 'turn-changes/recovery-run' ||
    command.type === 'turn-changes/recovery-verify'
  );
}

function toEntry(runtime: TurnChangeRuntime, row: TurnChangeOperationLogRow): TurnChangeOperationEntry {
  const summary = buildTurnChangeSummary(runtime.store, row.changeSetId) ?? null;
  return {
    operationId: row.operationId,
    changeSetId: row.changeSetId,
    sessionId: row.sessionId,
    workspaceId: row.workspaceId,
    direction: (row.kind === 'redo' ? 'redo' : 'undo') satisfies TurnChangeDirection,
    status: toOperationStatus(row.status),
    revision: row.expectedRevision,
    // A pre-check rejection records no files; the turn's count is what it covered.
    fileCount: row.fileCount > 0 ? row.fileCount : (summary?.fileCount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.reason ? { reason: row.reason } : {}),
    superseded: row.superseded,
    summary,
  };
}

/** One operation as an entry; undefined for unknown ids and subagent applies. */
function describeOperation(
  runtime: TurnChangeRuntime,
  operationId: string,
): TurnChangeOperationEntry | undefined {
  const operation = runtime.store.getOperation(operationId);
  if (!operation || (operation.kind !== 'undo' && operation.kind !== 'redo')) return undefined;
  const attempt = runtime.store.getAttempt(operation.changeSetId);
  const note = runtime.store.getOperationNote(operationId);
  const latest = runtime.store.getLatestChangeSetOperation(operation.changeSetId);
  return toEntry(runtime, {
    operationId,
    changeSetId: operation.changeSetId,
    kind: operation.kind,
    status: operation.status,
    expectedRevision: operation.expectedRevision,
    sessionId: attempt?.sessionId ?? '',
    workspaceId: note?.workspaceId ?? attempt?.workspaceId ?? '',
    createdAt: note?.createdAt ?? null,
    updatedAt: note?.updatedAt ?? null,
    reason: note?.reason ?? null,
    fileCount: runtime.store.listOperationFiles(operationId).length,
    superseded:
      latest !== undefined && latest.operationId !== operationId && latest.status === 'succeeded',
  });
}

function workspaceRootFor(runtime: TurnChangeRuntime, operationId: string): string | undefined {
  const operation = runtime.store.getOperation(operationId);
  const attempt = operation ? runtime.store.getAttempt(operation.changeSetId) : undefined;
  return attempt ? runtime.store.getWorkspace(attempt.workspaceId)?.rootPath : undefined;
}

function announceOperation(
  runtime: TurnChangeRuntime,
  push: ((message: import('@piwin/contracts').HostPush) => void) | undefined,
  operationId: string,
): void {
  const operation = runtime.store.getOperation(operationId);
  if (!operation) return;
  const summary = runtime.sealer.announce(operation.changeSetId, operationId);
  if (summary && push) {
    push({
      type: 'turn-changes/operation-updated',
      workspaceId: summary.workspaceId,
      operationId,
      changeSetId: operation.changeSetId,
    });
  }
}

export async function handleTurnChangeOperationCommand(
  command: OperationCommand,
  requestId: string | undefined,
  runtime: TurnChangeRuntime,
  push?: (message: import('@piwin/contracts').HostPush) => void,
): Promise<HostResponse> {
  switch (command.type) {
    case 'turn-changes/operation': {
      const entry = describeOperation(runtime, command.operationId);
      return entry
        ? ok(requestId, command.type, entry)
        : fail(requestId, command.type, 'operation not found', { code: 'not-found' });
    }
    case 'turn-changes/operations': {
      const workspaceId =
        command.workspaceId ??
        (command.projectPath ? workspaceIdForRoot(command.projectPath) : undefined);
      if (!workspaceId) {
        return fail(requestId, command.type, 'workspaceId or projectPath is required', {
          code: 'invalid-request',
        });
      }
      const limit = Math.min(MAX_OPERATION_PAGE, Math.max(1, command.limit ?? DEFAULT_OPERATION_PAGE));
      const listed = runtime.store.listWorkspaceOperations({
        workspaceId,
        limit,
        ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
      });
      const page: TurnChangeOperationPage = {
        workspaceId,
        operations: listed.rows.map((row) => toEntry(runtime, row)),
        nextCursor: listed.nextCursor,
      };
      return ok(requestId, command.type, page);
    }
    case 'turn-changes/cancel': {
      const operation = runtime.store.getOperation(command.operationId);
      if (!operation || (operation.kind !== 'undo' && operation.kind !== 'redo')) {
        return fail(requestId, command.type, 'operation not found', { code: 'not-found' });
      }
      if (operation.status !== 'applying') {
        // Already finished: report what happened instead of pretending to cancel.
        return ok(requestId, command.type, {
          operationId: command.operationId,
          status: toOperationStatus(operation.status),
          cancelled: operation.status === 'cancelled',
        });
      }
      const started = runtime.store
        .listOperationFiles(command.operationId)
        .some((file) => file.status !== 'intent');
      if (started) {
        // 已开始写入，正在安全完成: the runner finishes or rolls back on its own.
        return ok(requestId, command.type, {
          operationId: command.operationId,
          status: 'applying',
          cancelled: false,
          reason: 'write-started',
        });
      }
      runtime.store.requestOperationCancel(command.operationId);
      return ok(requestId, command.type, {
        operationId: command.operationId,
        status: 'applying',
        cancelled: true,
      });
    }
    case 'turn-changes/recovery-preview':
    case 'turn-changes/recovery-run':
    case 'turn-changes/recovery-verify': {
      const operation = runtime.store.getOperation(command.operationId);
      if (!operation || (operation.kind !== 'undo' && operation.kind !== 'redo')) {
        return fail(requestId, command.type, 'operation not found', { code: 'not-found' });
      }
      if (operation.expectedRevision !== command.expectedRevision) {
        return fail(requestId, command.type, 'stale-revision', { code: 'stale-revision' });
      }
      if (operation.status !== 'needs-repair') {
        return fail(requestId, command.type, 'operation does not need repair', {
          code: 'direction-unavailable',
        });
      }
      const workspaceRoot = workspaceRootFor(runtime, command.operationId);
      if (!workspaceRoot) {
        return fail(requestId, command.type, 'workspace not registered', {
          code: 'unsupported-workspace',
        });
      }
      if (command.type === 'turn-changes/recovery-preview') {
        const preview = await previewTurnChangeRepair({
          workspaceRoot,
          store: runtime.store,
          operationId: command.operationId,
        });
        const body: TurnChangeRepairPreview = {
          operationId: command.operationId,
          changeSetId: operation.changeSetId,
          revision: operation.expectedRevision,
          status: 'needs-repair',
          files: preview.files,
          confirmationToken: preview.confirmationToken,
        };
        return ok(requestId, command.type, body);
      }
      if (command.type === 'turn-changes/recovery-run') {
        const ran = await runTurnChangeRepair({
          workspaceRoot,
          store: runtime.store,
          objectStore: runtime.objectStore,
          operationId: command.operationId,
          confirmationToken: command.confirmationToken,
        });
        if (ran.outcome === 'stale-preview') {
          return fail(requestId, command.type, 'files changed since the preview', {
            code: 'files-changed',
          });
        }
        return ok(requestId, command.type, {
          operationId: command.operationId,
          outcome: ran.outcome,
          files: ran.files,
        });
      }
      const verified = await verifyTurnChangeRepair({
        workspaceRoot,
        store: runtime.store,
        operationId: command.operationId,
      });
      if (verified.verified) announceOperation(runtime, push, command.operationId);
      return ok(requestId, command.type, {
        operationId: command.operationId,
        verified: verified.verified,
        files: verified.files,
      });
    }
  }
}

export { announceOperation };

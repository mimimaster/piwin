/** Host IPC for turn-change read and undo/redo. */

import type { HostCommand, HostResponse, TurnChangeDirection } from '@piwin/contracts';
import { planUndoRedo, runTurnChangeOperation } from '@piwin/git';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'turn-changes/get',
  'turn-changes/list-by-runs',
  'turn-changes/files',
  'turn-changes/diff',
  'turn-changes/check',
  'turn-changes/undo',
  'turn-changes/redo',
  'turn-changes/operation',
  'turn-changes/operations',
  'turn-changes/cancel',
  'turn-changes/recovery-preview',
  'turn-changes/recovery-run',
  'turn-changes/recovery-verify',
]);

function unsupportedCapability(
  requestId: string | undefined,
  commandType: string,
): HostResponse {
  return fail(requestId, commandType, 'unsupported-capability', { code: 'unsupported-capability' });
}

export function isTurnChangeCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleTurnChangeCommand(
  command: HostCommand,
  requestId: string | undefined,
  context?: HostCommandContext,
): Promise<HostResponse | null> {
  if (!isTurnChangeCommand(command)) return null;
  const runtime = context?.turnChangeRuntime;
  if (!runtime) {
    return unsupportedCapability(requestId, command.type);
  }

  if (command.type === 'turn-changes/get') {
    const attempt = runtime.store.getAttempt(command.changeSetId);
    if (!attempt) {
      return fail(requestId, command.type, 'not-found', { code: 'not-found' });
    }
    return ok(requestId, command.type, {
      changeSetId: attempt.changeSetId,
      attemptId: attempt.attemptId,
      captureState: attempt.captureState,
      disposition: attempt.disposition,
      revision: attempt.activeRevision,
    });
  }

  if (command.type === 'turn-changes/undo' || command.type === 'turn-changes/redo') {
    const direction: TurnChangeDirection = command.type === 'turn-changes/undo' ? 'undo' : 'redo';
    const result = await runDirection(runtime, {
      changeSetId: command.changeSetId,
      expectedRevision: command.expectedRevision,
      direction,
      principal: 'host',
      idempotencyKey: requestId ?? `${command.type}:${command.changeSetId}`,
    });
    if (!result.ok) {
      return fail(requestId, command.type, result.message, { code: result.code });
    }
    return ok(requestId, command.type, result.data);
  }

  return unsupportedCapability(requestId, command.type);
}

async function runDirection(
  runtime: NonNullable<HostCommandContext['turnChangeRuntime']>,
  input: {
    changeSetId: string;
    expectedRevision: number;
    direction: TurnChangeDirection;
    principal: string;
    idempotencyKey: string;
  },
): Promise<
  | { ok: true; data: { operationId: string; status: string } }
  | { ok: false; code: string; message: string }
> {
  const attempt = runtime.store.getAttempt(input.changeSetId);
  if (!attempt) {
    return { ok: false, code: 'not-found', message: 'change set not found' };
  }
  const workspace = runtime.store.getWorkspace(attempt.workspaceId);
  if (!workspace) {
    return { ok: false, code: 'unsupported-workspace', message: 'workspace not registered' };
  }
  const version = runtime.store.getChangeVersion(input.changeSetId, input.expectedRevision);
  if (!version) {
    return { ok: false, code: 'stale-revision', message: 'change version not found' };
  }

  const acquired = await runtime.gate.tryAcquire({
    workspaceId: workspace.workspaceId,
    rootPath: workspace.rootPath,
    kind: 'undo',
    mode: 'exclusive',
    wait: false,
  });
  if (!acquired.ok) {
    return { ok: false, code: acquired.reason, message: acquired.reason };
  }

  try {
    const latest = runtime.store.getAttempt(input.changeSetId);
    if (!latest) {
      return { ok: false, code: 'not-found', message: 'change set not found' };
    }
    if (latest.captureState === 'incomplete') {
      return { ok: false, code: 'capture-incomplete', message: 'capture is incomplete' };
    }
    if (latest.captureState === 'expired') {
      return { ok: false, code: 'data-expired', message: 'change set expired' };
    }
    if (input.direction === 'undo' && latest.disposition !== 'applied') {
      return { ok: false, code: 'direction-unavailable', message: 'undo is not available' };
    }
    if (input.direction === 'redo' && latest.disposition !== 'undone') {
      return { ok: false, code: 'direction-unavailable', message: 'redo is not available' };
    }

    const currentVersion = runtime.store.getChangeVersion(
      input.changeSetId,
      input.expectedRevision,
    );
    if (!currentVersion) {
      return { ok: false, code: 'stale-revision', message: 'change version not found' };
    }
    const planned = planUndoRedo({
      direction: input.direction,
      files: currentVersion.files.map((file) => ({
        relativePath: file.relativePath,
        beforeSha: file.beforeSha,
        afterSha: file.afterSha,
        beforeExists: file.beforeSha !== null,
        afterExists: file.afterSha !== null,
      })),
    });
    const ran = await runTurnChangeOperation({
      workspaceRoot: workspace.rootPath,
      store: runtime.store,
      objectStore: runtime.objectStore,
      principal: input.principal,
      idempotencyKey: input.idempotencyKey,
      requestHash: `${input.direction}:${input.changeSetId}:${String(input.expectedRevision)}`,
      changeSetId: input.changeSetId,
      kind: input.direction,
      expectedRevision: input.expectedRevision,
      files: planned,
    });
    return { ok: true, data: { operationId: ran.operationId, status: ran.status } };
  } finally {
    acquired.lease.release();
  }
}

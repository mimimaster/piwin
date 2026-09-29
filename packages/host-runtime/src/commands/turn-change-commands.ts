/** Host IPC for turn-change read and undo/redo. */

import type { HostCommand, HostResponse, TurnChangeDirection } from '@piwin/contracts';
import { join, resolve } from 'node:path';

import { planUndoRedo, resolveFileLockKey, runTurnChangeOperation } from '@piwin/git';
import { fail, ok } from '../response-helpers.js';
import { buildTurnChangeSummary } from '../turn-changes/turn-summary.js';
import type { HostCommandContext } from './host-command-context.js';
import {
  handleTurnChangeQueryCommand,
  isTurnChangeQueryCommand,
} from './turn-change-query-commands.js';

/** How long undo/redo wait for their files before answering workspace-busy. */
export const TURN_CHANGE_LOCK_WAIT_MS = 5_000;

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

  if (isTurnChangeQueryCommand(command)) {
    return handleTurnChangeQueryCommand(command, requestId, runtime);
  }

  if (command.type === 'turn-changes/undo' || command.type === 'turn-changes/redo') {
    const direction: TurnChangeDirection = command.type === 'turn-changes/undo' ? 'undo' : 'redo';
    // Refuse what the summary already rules out (still recording, incomplete,
    // nothing changed) before taking the workspace lock.
    const summary = buildTurnChangeSummary(runtime.store, command.changeSetId);
    const availability = direction === 'undo' ? summary?.undo : summary?.redo;
    if (availability && !availability.allowed && availability.reason !== 'direction-unavailable') {
      return fail(requestId, command.type, availability.reason, { code: availability.reason });
    }
    const result = await runDirection(runtime, {
      changeSetId: command.changeSetId,
      expectedRevision: command.expectedRevision,
      direction,
      principal: 'host',
      idempotencyKey: requestId ?? `${command.type}:${command.changeSetId}`,
      ...(context?.turnChangeLockWaitMs !== undefined
        ? { lockWaitMs: context.turnChangeLockWaitMs }
        : {}),
    });
    if (!result.ok) {
      return fail(requestId, command.type, result.message, { code: result.code });
    }
    runtime.sealer.announce(command.changeSetId, result.data.operationId);
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
    lockWaitMs?: number;
  },
): Promise<
  | {
      ok: true;
      data: { operationId: string; status: string; reason?: string; affectedPaths?: string[] };
    }
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

  // Only this turn's files are locked (workspace shared + per-file
  // exclusive): other sessions' tests and reads keep running, Host writes to
  // these files wait, and repo-wide operations (checkout, install) still
  // exclude it. Undo's safety is its per-file hash check before and after
  // writing, not the lock. A short wait instead of failing fast rides out a
  // write in flight on the same file.
  const fileKeys = await Promise.all(
    version.files.map(async (file) => {
      const absolutePath = join(workspace.rootPath, file.relativePath);
      const key = await resolveFileLockKey(absolutePath);
      return key.ok ? key.key : resolve(absolutePath);
    }),
  );
  const acquired = await runtime.gate.tryAcquire({
    workspaceId: workspace.workspaceId,
    rootPath: workspace.rootPath,
    kind: 'undo',
    mode: 'shared',
    wait: true,
    paths: fileKeys,
    signal: AbortSignal.timeout(input.lockWaitMs ?? TURN_CHANGE_LOCK_WAIT_MS),
  });
  if (!acquired.ok) {
    // A wait that timed out is a busy workspace, not a user cancel.
    return { ok: false, code: 'workspace-busy', message: 'workspace-busy' };
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
    // A rejected run names the files that moved, so clients can show them.
    return {
      ok: true,
      data: {
        operationId: ran.operationId,
        status: ran.status,
        ...(ran.reason !== undefined ? { reason: ran.reason } : {}),
        ...(ran.affectedPaths !== undefined ? { affectedPaths: ran.affectedPaths } : {}),
      },
    };
  } finally {
    acquired.lease.release();
  }
}

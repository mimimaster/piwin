/**
 * One undo/redo gesture from the Desktop, end to end.
 *
 * The idempotency key is frozen at the click. If the socket drops before an
 * answer arrives, the gesture waits for the connection and resends the same
 * command with the same key: the Host replays the original operation instead
 * of running a second one, so a timeout is never shown as success and never
 * causes a double undo. While it waits the card says 结果尚未确认，正在重连….
 *
 * Progress (`N / M 个文件`) comes from `turn-changes/operation-updated`
 * pushes; cancel is only honored before the first write.
 */
import type { HostCommand, HostResponse, TurnChangePathConflict, TurnChangeSummary } from '@piwin/contracts';
import { createIdempotencyKey } from '@piwin/host-client';

import { isWorkbenchHostTeardownError } from '../workbench-host-teardown.js';

export type TurnChangesRequest = (
  command: HostCommand,
  options?: { idempotencyKey?: string },
) => Promise<HostResponse>;

/** `(connected) => void`; returns unsubscribe. Called with the current state first. */
export type SubscribeConnected = (listener: (connected: boolean) => void) => () => void;

export type TurnChangeRefusal = 'files-changed' | 'staged-paths' | 'backup-failed' | 'permission-denied';

export type TurnChangeActionResult =
  | { kind: 'done' }
  | {
      kind: 'conflict';
      reason: TurnChangeRefusal;
      affectedPaths: string[];
      /** With files-changed: who changed each path (empty = unknown). */
      conflicts: TurnChangePathConflict[];
    }
  /** Stopped before writing, or rolled back after a failed write: files are as before. */
  | { kind: 'not-applied'; reason: 'cancelled' | 'write-failed' }
  /** A write failed and could not be rolled back; see 代码撤销记录. */
  | { kind: 'needs-repair'; operationId: string }
  | { kind: 'error'; message: string };

/** What a running gesture reports to its card. */
export type TurnChangeGestureEvent =
  | { kind: 'reconnecting' }
  | { kind: 'resumed' }
  | { kind: 'started'; operationId: string };

const REFUSALS = new Set<string>(['files-changed', 'staged-paths', 'backup-failed', 'permission-denied']);

export function isHostDisconnect(message: string): boolean {
  return isWorkbenchHostTeardownError(message);
}

/** Resolve once `subscribeConnected` reports connected (immediately when it already is). */
function waitConnected(subscribe: SubscribeConnected, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      // Unsubscribing inside the synchronous first callback: defer until assigned.
      queueMicrotask(() => unsubscribe?.());
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => finish(new Error('aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    unsubscribe = subscribe((connected) => {
      if (connected) finish();
    });
    if (settled) unsubscribe();
  });
}

function interpret(response: HostResponse): TurnChangeActionResult {
  if (!response.success) return { kind: 'error', message: response.error };
  const data = response.data as {
    operationId?: string;
    status?: string;
    reason?: string;
    affectedPaths?: string[];
    conflicts?: TurnChangePathConflict[];
  };
  if (data.status === 'succeeded') return { kind: 'done' };
  if (data.reason !== undefined && REFUSALS.has(data.reason)) {
    return {
      kind: 'conflict',
      reason: data.reason as TurnChangeRefusal,
      affectedPaths: data.affectedPaths ?? [],
      conflicts: data.conflicts ?? [],
    };
  }
  if (data.status === 'needs-repair') return { kind: 'needs-repair', operationId: data.operationId ?? '' };
  if (data.status === 'cancelled' || data.status === 'rolled-back') {
    return { kind: 'not-applied', reason: data.status === 'cancelled' ? 'cancelled' : 'write-failed' };
  }
  return { kind: 'error', message: data.reason ?? data.status ?? 'unknown' };
}

/**
 * Run one gesture. Resends at most `maxResends` times, each only after the
 * connection is back; every send carries the gesture's single key.
 */
export async function runTurnChangeGesture(input: {
  request: TurnChangesRequest;
  subscribeConnected?: SubscribeConnected | undefined;
  summary: TurnChangeSummary;
  direction: 'undo' | 'redo';
  onEvent?: (event: TurnChangeGestureEvent) => void;
  maxResends?: number;
  signal?: AbortSignal;
}): Promise<TurnChangeActionResult> {
  const command: HostCommand = {
    type: input.direction === 'undo' ? 'turn-changes/undo' : 'turn-changes/redo',
    changeSetId: input.summary.changeSetId,
    expectedRevision: input.summary.revision,
  };
  const idempotencyKey = createIdempotencyKey();
  const maxResends = input.maxResends ?? 5;
  for (let attempt = 0; ; attempt += 1) {
    let disconnected: string | undefined;
    try {
      const response = await input.request(command, { idempotencyKey });
      if (response.success || !isHostDisconnect(response.error)) {
        if (attempt > 0) input.onEvent?.({ kind: 'resumed' });
        return interpret(response);
      }
      disconnected = response.error;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isHostDisconnect(message)) return { kind: 'error', message };
      disconnected = message;
    }
    // Without a way to see the connection come back, never guess: report it.
    if (!input.subscribeConnected || attempt >= maxResends) {
      return { kind: 'error', message: disconnected };
    }
    input.onEvent?.({ kind: 'reconnecting' });
    try {
      await waitConnected(input.subscribeConnected, input.signal);
    } catch {
      return { kind: 'error', message: disconnected };
    }
  }
}

/** Ask the Host to stop a running undo/redo before its first write. */
export async function cancelTurnChangeOperation(
  request: TurnChangesRequest,
  operationId: string,
): Promise<'cancelled' | 'write-started' | 'finished' | 'failed'> {
  try {
    const response = await request({ type: 'turn-changes/cancel', operationId }, { idempotencyKey: createIdempotencyKey() });
    if (!response.success) return 'failed';
    const data = response.data as { cancelled?: boolean; reason?: string; status?: string };
    if (data.cancelled) return 'cancelled';
    if (data.reason === 'write-started') return 'write-started';
    return 'finished';
  } catch {
    return 'failed';
  }
}

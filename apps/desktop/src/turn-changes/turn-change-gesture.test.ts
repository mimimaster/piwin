import { describe, expect, it, vi } from 'vitest';

import type { HostCommand, HostResponse, TurnChangeSummary } from '@piwin/contracts';
import { runTurnChangeGesture, type SubscribeConnected } from './turn-change-gesture';

const summary = { changeSetId: 'cs-1', revision: 3 } as TurnChangeSummary;

function ok(data: unknown): HostResponse {
  return { type: 'response', command: 'turn-changes/undo', success: true, data } as HostResponse;
}
function failed(error: string): HostResponse {
  return { type: 'response', command: 'turn-changes/undo', success: false, error } as HostResponse;
}

/** A connection that is down until `reconnect()`. */
function connection(): { subscribe: SubscribeConnected; reconnect: () => void } {
  let connected = false;
  const listeners = new Set<(value: boolean) => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      listener(connected);
      return () => listeners.delete(listener);
    },
    reconnect: () => {
      connected = true;
      for (const listener of [...listeners]) listener(true);
    },
  };
}

describe('runTurnChangeGesture', () => {
  it('resends the same command and key only after the connection is back', async () => {
    const link = connection();
    const calls: Array<{ command: HostCommand; key: string | undefined }> = [];
    const request = vi.fn(async (command: HostCommand, options?: { idempotencyKey?: string }) => {
      calls.push({ command, key: options?.idempotencyKey });
      return calls.length === 1 ? failed('Host transport is not open') : ok({ operationId: 'op-1', status: 'succeeded' });
    });
    const events: string[] = [];
    const pending = runTurnChangeGesture({
      request,
      subscribeConnected: link.subscribe,
      summary,
      direction: 'undo',
      onEvent: (event) => events.push(event.kind),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(1);
    expect(events).toEqual(['reconnecting']);
    link.reconnect();
    expect(await pending).toEqual({ kind: 'done' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.command).toEqual(calls[0]?.command);
    expect(calls[1]?.key).toBe(calls[0]?.key);
    expect(calls[0]?.key).toBeTruthy();
    expect(events).toEqual(['reconnecting', 'resumed']);
  });

  it('reports a disconnect as an error, never success, when it cannot watch the connection', async () => {
    const request = vi.fn(async () => {
      throw new Error('Host connection closed');
    });
    expect(await runTurnChangeGesture({ request, summary, direction: 'redo' })).toEqual({
      kind: 'error',
      message: 'Host connection closed',
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('maps refusals with their paths and later turns', async () => {
    const conflicts = [{ relativePath: 'a.ts', laterTurns: [] }];
    const request = vi.fn(async () =>
      ok({ status: 'rejected', reason: 'staged-paths', affectedPaths: ['a.ts'], conflicts }),
    );
    expect(await runTurnChangeGesture({ request, summary, direction: 'undo' })).toEqual({
      kind: 'conflict',
      reason: 'staged-paths',
      affectedPaths: ['a.ts'],
      conflicts,
    });
  });

  it('uses a new key per gesture', async () => {
    const keys: Array<string | undefined> = [];
    const request = vi.fn(async (_command: HostCommand, options?: { idempotencyKey?: string }) => {
      keys.push(options?.idempotencyKey);
      return ok({ status: 'succeeded' });
    });
    await runTurnChangeGesture({ request, summary, direction: 'undo' });
    await runTurnChangeGesture({ request, summary, direction: 'undo' });
    expect(keys[0]).not.toBe(keys[1]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, HostServerMessage } from '@piwin/contracts';
import type { HostRuntime } from '@piwin/host-runtime';
import { createHostServeDispatcher } from './host-serve-dispatcher.js';
import type { HostServeSend } from './host-serve-dispatcher.js';

function createMockRuntime(handlers: {
  onCommand: (command: HostCommand) => Promise<HostResponse> | HostResponse;
}): Pick<HostRuntime, 'handleCommand'> {
  return {
    handleCommand: vi.fn(async (command: HostCommand) => handlers.onCommand(command)),
  };
}

describe('createHostServeDispatcher', () => {
  it('dispatches control commands without waiting for serialized work', async () => {
    const order: string[] = [];
    let releaseSerialized: (() => void) | undefined;
    const serializedGate = new Promise<void>((resolve) => {
      releaseSerialized = resolve;
    });

    const runtime = createMockRuntime({
      onCommand: async (command) => {
        order.push(`start:${command.type}`);
        if (command.type === 'settings/apply') {
          await serializedGate;
        }
        order.push(`end:${command.type}`);
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {},
        };
      },
    });

    const written: string[] = [];
    const send: HostServeSend = async (message: HostServerMessage) => {
      if (message && typeof message === 'object' && 'command' in message) {
        written.push(String((message as { command: string }).command));
      }
    };

    const dispatcher = createHostServeDispatcher({
      runtime: runtime as HostRuntime,
      send,
      commandTimeoutMs: 5_000,
    });

    dispatcher.dispatch({
      type: 'settings/apply',
      input: { mutations: [] },
    });
    // Give serialized task a tick to start.
    await new Promise((resolve) => setTimeout(resolve, 10));

    dispatcher.dispatch({ type: 'session/abort', sessionId: 's1' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Abort should have finished while config/set is still gated.
    expect(order).toContain('start:settings/apply');
    expect(order).toContain('start:session/abort');
    expect(order).toContain('end:session/abort');
    expect(order).not.toContain('end:settings/apply');

    if (releaseSerialized === undefined) {
      throw new Error('serialized command gate was not initialized');
    }
    releaseSerialized();
    await dispatcher.drain();
    expect(order).toContain('end:settings/apply');
    expect(written).toContain('session/abort');
    expect(written).toContain('settings/apply');
  });

  it('waits for active concurrent commands before draining', async () => {
    let releaseConcurrent: (() => void) | undefined;
    const concurrentGate = new Promise<void>((resolve) => {
      releaseConcurrent = resolve;
    });
    const runtime = createMockRuntime({
      onCommand: async (command) => {
        await concurrentGate;
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {},
        };
      },
    });
    const send: HostServeSend = vi.fn(async () => undefined);
    const dispatcher = createHostServeDispatcher({
      runtime: runtime as HostRuntime,
      send,
    });

    dispatcher.dispatch({ type: 'session/list', projectPath: '/tmp/project' });
    const drainPromise = dispatcher.drain();
    let drainFinished = false;
    void drainPromise.then(() => {
      drainFinished = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(drainFinished).toBe(false);
    if (releaseConcurrent === undefined) {
      throw new Error('concurrent command gate was not initialized');
    }
    releaseConcurrent();
    await drainPromise;
    expect(drainFinished).toBe(true);
  });

  it('keeps waiting for compaction after the ordinary command deadline', async () => {
    let releaseCompaction: (() => void) | undefined;
    const compactionGate = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });
    const runtime = createMockRuntime({
      onCommand: async (command) => {
        await compactionGate;
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { ok: true },
        };
      },
    });
    const sent: HostServerMessage[] = [];
    const dispatcher = createHostServeDispatcher({
      runtime: runtime as HostRuntime,
      send: async (message) => {
        sent.push(message);
      },
      commandTimeoutMs: 10,
    });

    dispatcher.dispatch({ type: 'session/compact', sessionId: 'session-1' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(sent).toHaveLength(0);

    if (releaseCompaction === undefined) {
      throw new Error('compaction gate was not initialized');
    }
    releaseCompaction();
    await dispatcher.drain();
    expect(sent).toEqual([expect.objectContaining({ command: 'session/compact', success: true })]);
  });

  it('does not accept commands after draining starts', async () => {
    const runtime = createMockRuntime({
      onCommand: async (command) => ({
        type: 'response',
        command: command.type,
        success: true,
        data: {},
      }),
    });
    const send: HostServeSend = vi.fn(async () => undefined);
    const dispatcher = createHostServeDispatcher({
      runtime: runtime as HostRuntime,
      send,
    });

    await dispatcher.drain();
    dispatcher.dispatch({ type: 'host/ping' });

    expect(runtime.handleCommand).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

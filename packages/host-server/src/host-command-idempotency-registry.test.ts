import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  HostCommandIdempotencyRegistry,
  admitAndExecuteHostCommand,
} from './host-command-idempotency-registry.js';

const prompt = (text: string): HostCommand => ({
  type: 'session/prompt',
  sessionId: 's1',
  input: { text },
  foreground: { kind: 'if-idle' },
});

function ok(command: HostCommand, data: unknown = { runId: 'run-1' }): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

describe('HostCommandIdempotencyRegistry', () => {
  it('joins an in-flight same-key retry and replays a completed entry', async () => {
    const registry = new HostCommandIdempotencyRegistry();
    const command = prompt('once');
    let executions = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'gesture-1',
      command,
      execute: async () => {
        executions += 1;
        await gate;
        return ok(command);
      },
    });
    const joined = admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'gesture-1',
      command,
      execute: async () => {
        executions += 1;
        return ok(command);
      },
    });
    release?.();
    const [firstResult, joinedResult] = await Promise.all([first, joined]);
    expect(executions).toBe(1);
    expect(firstResult).toEqual(joinedResult);

    const replayed = await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'gesture-1',
      command,
      execute: async () => {
        executions += 1;
        return ok(command);
      },
    });
    expect(executions).toBe(1);
    expect(replayed.success).toBe(true);
  });

  it('conflicts when the same key is bound to a different digest', async () => {
    const registry = new HostCommandIdempotencyRegistry();
    await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'gesture-1',
      command: prompt('one'),
      execute: async () => ok(prompt('one')),
    });
    const conflict = await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'gesture-1',
      command: prompt('two'),
      execute: async () => ok(prompt('two')),
    });
    expect(conflict).toMatchObject({
      success: false,
      problem: { code: 'idempotency-conflict' },
    });
  });

  it('replays a completed key after more than five minutes on the same instance', async () => {
    vi.useFakeTimers();
    try {
      const registry = new HostCommandIdempotencyRegistry();
      const command = prompt('linger');
      let executions = 0;
      await admitAndExecuteHostCommand({
        registry,
        principalId: 'device-a',
        idempotencyKey: 'long-lived',
        command,
        execute: async () => {
          executions += 1;
          return ok(command);
        },
      });
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      const replayed = await admitAndExecuteHostCommand({
        registry,
        principalId: 'device-a',
        idempotencyKey: 'long-lived',
        command,
        execute: async () => {
          executions += 1;
          return ok(command);
        },
      });
      expect(executions).toBe(1);
      expect(replayed.success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a new key at capacity without evicting accepted keys', async () => {
    const registry = new HostCommandIdempotencyRegistry({ maxEntries: 1 });
    const firstCommand = prompt('keep');
    await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'kept',
      command: firstCommand,
      execute: async () => ok(firstCommand),
    });
    const refused = await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'new',
      command: prompt('new'),
      execute: async () => ok(prompt('new')),
    });
    expect(refused).toMatchObject({
      success: false,
      problem: { code: 'idempotency-registry-capacity' },
    });
    const replayed = await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'kept',
      command: firstCommand,
      execute: async () => ok(firstCommand, { runId: 'should-not-run' }),
    });
    expect(replayed.success).toBe(true);
    if (replayed.success) {
      expect(replayed.data).toEqual({ runId: 'run-1' });
    }
  });

  it('does not store path-bearing or oversized responses and still occupies the key', async () => {
    const registry = new HostCommandIdempotencyRegistry({ maxResponseBytes: 64 });
    const command = prompt('media');
    await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'media-1',
      command,
      execute: async () =>
        ok(command, { asset: { id: 'a1', absolutePath: '/Users/me/.piwin/media/a1.png' } }),
    });
    const replayed = await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: 'media-1',
      command,
      execute: async () => ok(command, { runId: 'should-not-run' }),
    });
    expect(replayed.success).toBe(true);
    if (replayed.success) {
      expect(replayed.data).toBeUndefined();
    }
  });

  it('does not replay a disposed table after a new Host identity', async () => {
    const first = new HostCommandIdempotencyRegistry();
    const command = prompt('reset');
    let executions = 0;
    await admitAndExecuteHostCommand({
      registry: first,
      principalId: 'device-a',
      idempotencyKey: 'surviving-key',
      command,
      execute: async () => {
        executions += 1;
        return ok(command);
      },
    });
    first.dispose();
    const second = new HostCommandIdempotencyRegistry();
    await admitAndExecuteHostCommand({
      registry: second,
      principalId: 'device-a',
      idempotencyKey: 'surviving-key',
      command,
      execute: async () => {
        executions += 1;
        return ok(command);
      },
    });
    expect(executions).toBe(2);
  });

  it('fails a required mutation before execute when the key is missing', async () => {
    const registry = new HostCommandIdempotencyRegistry();
    let executions = 0;
    const result = await admitAndExecuteHostCommand({
      registry,
      principalId: 'device-a',
      idempotencyKey: undefined,
      command: prompt('no-key'),
      execute: async () => {
        executions += 1;
        return ok(prompt('no-key'));
      },
    });
    expect(executions).toBe(0);
    expect(result).toMatchObject({
      success: false,
      problem: { code: 'idempotency-key-required' },
    });
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecutionRunRecord, HostResponse } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';
import type { SessionActivationProbe } from './host-runtime-types.js';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T = void>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

/** One deferred per key, whichever side (producer or waiter) asks first. */
function deferredMap<T>() {
  const entries = new Map<string, Deferred<T>>();
  return (key: string): Deferred<T> => {
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = deferred<T>();
      entries.set(key, entry);
    }
    return entry;
  };
}

/**
 * A Host whose first cold activation is held at one step until released.
 * Everything is observed through the activation probe and the Host's pushes.
 */
async function openHostHoldingFirst(step: 'admitted' | 'creating', label: string) {
  const terminals = deferredMap<ExecutionRunRecord>();
  const runtimeRequest = deferredMap<void>();
  const entered = deferred();
  const released = deferred();
  const createdGenerations: string[] = [];
  const droppedGenerations: string[] = [];
  let held = false;
  const holdOnce = async (): Promise<void> => {
    if (held) return;
    held = true;
    entered.resolve();
    await released.promise;
  };
  const activationProbe: SessionActivationProbe = {
    requested: ({ runId }) => {
      if (runId !== undefined) runtimeRequest(runId).resolve();
    },
    admitted: () => (step === 'admitted' ? holdOnce() : undefined),
    creating: ({ runtimeGenerationId }) => {
      createdGenerations.push(runtimeGenerationId);
      return step === 'creating' ? holdOnce() : undefined;
    },
    dropped: ({ runtimeGenerationId }) => {
      droppedGenerations.push(runtimeGenerationId);
    },
  };
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: true,
    piwinRoot: await mkdtemp(join(tmpdir(), `piwin-host-activation-${label}-`)),
    activationProbe,
    onPush: (push) => {
      if (push.type === 'run/terminal') terminals(push.run.runId).resolve(push.run);
    },
  });
  const created = await runtime.handleCommand({
    type: 'session/create',
    input: { projectPath: `/tmp/activation-${label}` },
  });
  if (!created.success) throw new Error(created.error);
  const sessionId = (created.data as { sessionId: string }).sessionId;
  const prompt = async (text: string): Promise<string> =>
    acceptedRunId(
      await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text },
        foreground: { kind: 'if-idle' },
      }),
    );
  return {
    runtime,
    sessionId,
    prompt,
    /** The first activation reached the held step. */
    entered: entered.promise,
    release: () => released.resolve(),
    requestedBy: (runId: string) => runtimeRequest(runId).promise,
    terminal: (runId: string) => terminals(runId).promise,
    createdGenerations,
    droppedGenerations,
  };
}

function acceptedRunId(response: HostResponse): string {
  if (!response.success) throw new Error(response.error);
  return (response.data as { runId: string }).runId;
}

describe('stopping a Run during cold activation', () => {
  it('creates no runtime for a Run stopped while its activation is still preparing', async () => {
    const host = await openHostHoldingFirst('admitted', 'prepare-cancel');
    const { runtime, sessionId } = host;

    const stoppedRunId = await host.prompt('stopped before its runtime is created');
    await host.entered;
    expect(
      await runtime.handleCommand({ type: 'session/abort', sessionId, runId: stoppedRunId }),
    ).toMatchObject({ success: true, data: { cancelled: true } });
    expect((await host.terminal(stoppedRunId)).status).toBe('cancelled');
    const nextRunId = await host.prompt('the next turn');
    await host.requestedBy(nextRunId);
    host.release();
    const next = await host.terminal(nextRunId);

    expect(next.status).toBe('completed');
    // Only the next turn's runtime was ever created, and nothing had to be released.
    expect(host.createdGenerations).toEqual([next.runtimeGenerationId]);
    expect(host.droppedGenerations).toEqual([]);
    await runtime.dispose();
  });

  it('cancels that activation, and the next turn activates its own runtime and completes', async () => {
    const host = await openHostHoldingFirst('creating', 'cancel');
    const { runtime, sessionId } = host;

    const stoppedRunId = await host.prompt('stopped while its runtime is created');
    await host.entered;
    expect(
      await runtime.handleCommand({ type: 'session/abort', sessionId, runId: stoppedRunId }),
    ).toMatchObject({ success: true, data: { cancelled: true } });
    // Stop is reflected at once, while the runtime is still being created.
    const stopped = await host.terminal(stoppedRunId);
    expect(stopped.status).toBe('cancelled');
    expect(stopped.runtimeGenerationId).toBeUndefined();
    expect(
      await runtime.handleCommand({ type: 'session/foreground-run', sessionId }),
    ).toMatchObject({ success: true, data: { run: null } });

    // The next turn asks for the runtime while the cancelled creation is unfinished.
    const nextRunId = await host.prompt('the next turn');
    await host.requestedBy(nextRunId);
    host.release();
    const next = await host.terminal(nextRunId);

    expect(next.status).toBe('completed');
    // The cancelled creation released its runtime; the next turn runs on its own.
    expect(host.createdGenerations).toHaveLength(2);
    expect(host.droppedGenerations).toEqual([host.createdGenerations[0]]);
    expect(next.runtimeGenerationId).toBe(host.createdGenerations[1]);
    await runtime.dispose();
  });
});

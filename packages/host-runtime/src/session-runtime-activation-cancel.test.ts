import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecutionRunRecord, HostResponse } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';
import type { ProductAgentHost } from './product-agent-host.js';
import type { RunRegistry } from './run-registry.js';

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

type ActivateSessionRuntime = (
  sessionId: string,
  runId?: string,
  signal?: AbortSignal,
  excludeSeedMessageId?: string,
) => Promise<unknown>;

/**
 * Hold the next runtime creation until released. Records which Runs asked
 * for the session's runtime, and every runtime created and dropped.
 */
function gateNextActivation(runtime: HostRuntime) {
  const kernel = runtime as unknown as { activateSessionRuntime: ActivateSessionRuntime };
  const activateSessionRuntime = kernel.activateSessionRuntime.bind(runtime);
  const runtimeRequest = deferredMap<void>();
  kernel.activateSessionRuntime = (sessionId, runId, signal, excludeSeedMessageId) => {
    const activating = activateSessionRuntime(sessionId, runId, signal, excludeSeedMessageId);
    if (runId !== undefined) runtimeRequest(runId).resolve();
    return activating;
  };

  const host = runtime.host;
  const activateSession = host.activateSession.bind(host);
  const dropSession = host.dropSession.bind(host);
  const entered = deferred();
  const released = deferred();
  const activatedGenerations: string[] = [];
  const droppedSessions: string[] = [];
  host.activateSession = async (...args: Parameters<ProductAgentHost['activateSession']>) => {
    activatedGenerations.push(args[2]);
    if (activatedGenerations.length === 1) {
      entered.resolve();
      await released.promise;
    }
    return activateSession(...args);
  };
  host.dropSession = async (sessionId: string) => {
    droppedSessions.push(sessionId);
    return dropSession(sessionId);
  };
  return {
    entered: entered.promise,
    release: () => released.resolve(),
    requestedBy: (runId: string) => runtimeRequest(runId).promise,
    activatedGenerations,
    droppedSessions,
  };
}

function acceptedRunId(response: HostResponse): string {
  if (!response.success) throw new Error(response.error);
  return (response.data as { runId: string }).runId;
}

type ResidencyAdmission = {
  beginActivation: (...args: unknown[]) => Promise<unknown>;
};

/** Hold the first residency admission's answer until released. */
function gateFirstAdmission(runtime: HostRuntime) {
  const residency = (runtime as unknown as { residencyController: ResidencyAdmission })
    .residencyController;
  const beginActivation = residency.beginActivation.bind(residency);
  const entered = deferred();
  const released = deferred();
  let admissions = 0;
  residency.beginActivation = async (...args) => {
    const admitted = await beginActivation(...args);
    admissions += 1;
    if (admissions === 1) {
      entered.resolve();
      await released.promise;
    }
    return admitted;
  };
  return { entered: entered.promise, release: () => released.resolve() };
}

describe('stopping a Run during cold activation', () => {
  it('creates no runtime for a Run stopped while its activation is still preparing', async () => {
    const terminals = deferredMap<ExecutionRunRecord>();
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: await mkdtemp(join(tmpdir(), 'piwin-host-activation-prepare-cancel-')),
      onPush: (push) => {
        if (push.type === 'run/terminal') terminals(push.run.runId).resolve(push.run);
      },
    });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/activation-prepare-cancel' },
    });
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const activation = gateNextActivation(runtime);
    const admission = gateFirstAdmission(runtime);

    const stoppedRunId = acceptedRunId(
      await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'stopped before its runtime is created' },
        foreground: { kind: 'if-idle' },
      }),
    );
    await admission.entered;
    expect(
      await runtime.handleCommand({ type: 'session/abort', sessionId, runId: stoppedRunId }),
    ).toMatchObject({ success: true, data: { cancelled: true } });
    expect((await terminals(stoppedRunId).promise).status).toBe('cancelled');
    const nextRunId = acceptedRunId(
      await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'the next turn' },
        foreground: { kind: 'if-idle' },
      }),
    );
    await activation.requestedBy(nextRunId);
    admission.release();
    // Only the next turn's runtime is ever created; the gate on creation is its.
    await activation.entered;
    expect(activation.activatedGenerations).toHaveLength(1);
    activation.release();
    const next = await terminals(nextRunId).promise;

    expect(next.status).toBe('completed');
    expect(activation.activatedGenerations).toHaveLength(1);
    expect(activation.droppedSessions).toEqual([]);
    expect(next.runtimeGenerationId).toBe(activation.activatedGenerations[0]);
    await runtime.dispose();
  });


  it('cancels that activation, and the next turn activates its own runtime and completes', async () => {
    const terminals = deferredMap<ExecutionRunRecord>();
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: await mkdtemp(join(tmpdir(), 'piwin-host-activation-cancel-')),
      onPush: (push) => {
        if (push.type === 'run/terminal') terminals(push.run.runId).resolve(push.run);
      },
    });
    const registry = (runtime as unknown as { runRegistry: RunRegistry }).runRegistry;
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/activation-cancel' },
    });
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const activation = gateNextActivation(runtime);

    const stoppedRunId = acceptedRunId(
      await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'stopped while its runtime is created' },
        foreground: { kind: 'if-idle' },
      }),
    );
    await activation.entered;
    expect(
      await runtime.handleCommand({ type: 'session/abort', sessionId, runId: stoppedRunId }),
    ).toMatchObject({ success: true, data: { cancelled: true } });
    // Stop is reflected at once, while the runtime is still being created.
    const stopped = await terminals(stoppedRunId).promise;
    expect(stopped.status).toBe('cancelled');
    expect(
      await runtime.handleCommand({ type: 'session/foreground-run', sessionId }),
    ).toMatchObject({ success: true, data: { run: null } });

    // The next turn asks for the runtime while the cancelled creation is unfinished.
    const nextRunId = acceptedRunId(
      await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'the next turn' },
        foreground: { kind: 'if-idle' },
      }),
    );
    await activation.requestedBy(nextRunId);
    activation.release();
    const next = await terminals(nextRunId).promise;

    expect(next.status).toBe('completed');
    // The cancelled creation released its runtime and never attached it.
    expect(activation.droppedSessions).toEqual([sessionId]);
    expect(registry.get(stoppedRunId)?.runtimeGenerationId).toBeUndefined();
    expect(activation.activatedGenerations).toHaveLength(2);
    expect(next.runtimeGenerationId).toBe(activation.activatedGenerations[1]);
    await runtime.dispose();
  });
});

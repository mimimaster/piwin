import { describe, expect, it } from 'vitest';
import { createSessionRuntimeResidencyController } from './sessions/session-runtime-residency-controller.js';
import { createSubagentWorkerAdmission } from './subagent-worker-admission.js';
import { applyWorkerPoolSize, type WorkerPoolApplyTarget } from './worker-pool-policy.js';

async function occupyEphemeral(
  admission: ReturnType<typeof createSubagentWorkerAdmission>,
  sessionId: string,
) {
  const handle = await admission.begin({
    sessionId,
    runtimeGenerationId: `g-${sessionId}`,
    signal: new AbortController().signal,
  });
  handle.commit();
  return handle;
}

async function waitForWaiters(getCount: () => number, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (getCount() === expected) return;
    await Promise.resolve();
  }
  expect(getCount()).toBe(expected);
}

describe('worker pool convergence', () => {
  it('runs 4 ephemeral tasks beside a busy foreground; the 5th waits on the pool', async () => {
    const residency = createSessionRuntimeResidencyController({
      retention: { idleTtlSeconds: 600, maxIdleRuntimes: 2 },
      resolveMaxResidentRuntimes: () => 5,
    });
    const admission = createSubagentWorkerAdmission({
      refreshWorkerRssSample: async () => {},
      publishWaitingResourceWhileQueued: async () => {},
      residencyController: residency,
    });

    const fg = await residency.beginActivation('fg', 'g-fg', new AbortController().signal);
    expect(fg.ok).toBe(true);
    residency.commitActivation('fg', 'g-fg');
    residency.markBusy('fg', 'g-fg');

    const running = [];
    for (const id of ['e1', 'e2', 'e3', 'e4']) {
      running.push(await occupyEphemeral(admission, id));
    }
    expect(residency.getCounts().ephemeral).toBe(4);
    expect(residency.getCounts().waiterCount).toBe(0);

    const fifth = admission.begin({
      sessionId: 'e5',
      runtimeGenerationId: 'g-e5',
      signal: new AbortController().signal,
    });
    await waitForWaiters(() => residency.getCounts().waiterCount, 1);

    running[0]?.release();
    const fifthHandle = await fifth;
    fifthHandle.commit();
    expect(residency.getCounts().waiterCount).toBe(0);
    fifthHandle.release();
    for (const handle of running.slice(1)) handle.release();
  });

  it('evicts an idle foreground so four ephemeral tasks run without waiting', async () => {
    const residency = createSessionRuntimeResidencyController({
      retention: { idleTtlSeconds: 600, maxIdleRuntimes: 2 },
      resolveMaxResidentRuntimes: () => 5,
      suspendRuntime: async () => true,
    });
    const admission = createSubagentWorkerAdmission({
      refreshWorkerRssSample: async () => {},
      publishWaitingResourceWhileQueued: async () => {},
      residencyController: residency,
    });
    const idle = await residency.beginActivation('fg-idle', 'g-idle', new AbortController().signal);
    expect(idle.ok).toBe(true);
    residency.commitActivation('fg-idle', 'g-idle');
    const busy = await residency.beginActivation('fg-busy', 'g-busy', new AbortController().signal);
    expect(busy.ok).toBe(true);
    residency.commitActivation('fg-busy', 'g-busy');
    residency.markBusy('fg-busy', 'g-busy');

    const running = [];
    for (const id of ['e1', 'e2', 'e3', 'e4']) {
      running.push(await occupyEphemeral(admission, id));
    }
    expect(residency.getResidency('fg-idle')).toBe('cold');
    expect(residency.getCounters().evictedByMaxResident).toBe(1);
    expect(residency.getCounts().waiterCount).toBe(0);
    expect(residency.getCounts().ephemeral).toBe(4);
    for (const handle of running) handle.release();
  });

  it('applyWorkerPoolSize raising the cap grants a pool waiter', async () => {
    let poolSize = 2;
    const residency = createSessionRuntimeResidencyController({
      retention: { idleTtlSeconds: 600, maxIdleRuntimes: 2 },
      resolveMaxResidentRuntimes: () => poolSize,
    });
    const target: WorkerPoolApplyTarget = {
      workerPoolSize: 2,
      supervisorMax: 3,
      subagentQuota: 1,
      workerPoolOverParallelismLogged: false,
      workerCapacityExhaustWarnLogged: false,
      agentWorkerSupervisor: { setMaxActiveWorkers: () => {} },
      runtimeResourceCoordinator: { setSubagentMaxConcurrency: () => {} },
      residencyController: {
        revisitCapacity: () => {
          poolSize = target.workerPoolSize;
          residency.revisitCapacity();
        },
      },
      push: () => {},
    };
    const admission = createSubagentWorkerAdmission({
      refreshWorkerRssSample: async () => {},
      publishWaitingResourceWhileQueued: async () => {},
      residencyController: residency,
    });
    await occupyEphemeral(admission, 'e1');
    await occupyEphemeral(admission, 'e2');
    const waiting = admission.begin({
      sessionId: 'e3',
      runtimeGenerationId: 'g-e3',
      signal: new AbortController().signal,
    });
    await waitForWaiters(() => residency.getCounts().waiterCount, 1);
    applyWorkerPoolSize(target, 6, 16);
    await waiting;
    expect(residency.getCounts().waiterCount).toBe(0);
  });
});

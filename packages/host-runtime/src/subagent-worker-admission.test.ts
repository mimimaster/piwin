import { describe, expect, it } from 'vitest';
import { createSessionRuntimeResidencyController } from './sessions/session-runtime-residency-controller.js';
import { createSubagentWorkerAdmission } from './subagent-worker-admission.js';

function createAdmission(maxResidentRuntimes: number, sampleHighRss = false) {
  const controller = createSessionRuntimeResidencyController({
    retention: {
      idleTtlSeconds: 600,
      maxIdleRuntimes: 2,
      ...(sampleHighRss ? { memoryHighWaterMiB: 512 } : {}),
    },
    resolveMaxResidentRuntimes: () => maxResidentRuntimes,
    ...(sampleHighRss
      ? {
          sampleMemory: () => ({
            hostRssMiB: 800,
            workerRssMiB: 0,
            sampleCompleteness: 'complete' as const,
          }),
        }
      : {}),
  });
  const admission = createSubagentWorkerAdmission({
    refreshWorkerRssSample: async () => {},
    publishWaitingResourceWhileQueued: async () => {},
    residencyController: controller,
  });
  return { controller, admission };
}

describe('createSubagentWorkerAdmission', () => {
  it('reserves an ephemeral slot and releases it', async () => {
    const { controller, admission } = createAdmission(2);
    const handle = await admission.begin({
      sessionId: 'child-1',
      runtimeGenerationId: 'g1',
      signal: new AbortController().signal,
    });
    handle.commit();
    expect(controller.getResidency('child-1')).toBe('resident-busy');
    expect(controller.getCounts().ephemeral).toBe(1);
    handle.release();
    expect(controller.getResidency('child-1')).toBe('cold');
  });

  it('queues when the pool is full and abort drops the waiter', async () => {
    const { controller, admission } = createAdmission(1);
    const first = await admission.begin({
      sessionId: 'child-1',
      runtimeGenerationId: 'g1',
      signal: new AbortController().signal,
    });
    first.commit();
    const queuedSignal = new AbortController();
    const queued = admission.begin({
      sessionId: 'child-2',
      runtimeGenerationId: 'g2',
      signal: queuedSignal.signal,
    });
    for (let attempt = 0; attempt < 50 && controller.getCounts().waiterCount !== 1; attempt += 1) {
      await Promise.resolve();
    }
    expect(controller.getCounts().waiterCount).toBe(1);
    queuedSignal.abort();
    await expect(queued).rejects.toThrow('aborted');
    expect(controller.getCounts().waiterCount).toBe(0);
    first.release();
  });

  it('throws runtime-memory-pressure without admitting', async () => {
    const { controller, admission } = createAdmission(8, true);
    await expect(
      admission.begin({
        sessionId: 'child-1',
        runtimeGenerationId: 'g1',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('runtime-memory-pressure') });
    expect(controller.getCounts().resident).toBe(0);
  });
});

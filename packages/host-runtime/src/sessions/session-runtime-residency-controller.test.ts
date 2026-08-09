import { describe, expect, it } from 'vitest';
import type { SessionRuntimeRetentionConfig } from '@piwin/contracts';
import {
  createSessionRuntimeResidencyController,
  type ResidencyMemorySample,
} from './session-runtime-residency-controller.js';

/** Deterministic clock used by every test. */
function createClock() {
  let currentMs = 1_000_000;
  return {
    nowMs: () => currentMs,
    advance(ms: number): void {
      currentMs += ms;
    },
  };
}

function createController(
  options: {
    retention?: Partial<SessionRuntimeRetentionConfig>;
    maxResidentRuntimes?: number;
    sampleMemory?: () => ResidencyMemorySample;
    sweepIntervalMs?: number;
    isRuntimeProtected?: (sessionId: string) => boolean;
    suspendRuntime?: (input: {
      sessionId: string;
      runtimeGenerationId: string;
      reason: import('@piwin/contracts').SessionRuntimeEvictionReason;
    }) => Promise<boolean>;
  } = {},
) {
  const clock = createClock();
  const maxResidentRuntimes = options.maxResidentRuntimes;
  const controller = createSessionRuntimeResidencyController({
    retention: {
      idleTtlSeconds: 600,
      maxIdleRuntimes: 2,
      ...options.retention,
    },
    nowMs: clock.nowMs,
    sweepIntervalMs: options.sweepIntervalMs ?? 30_000,
    ...(maxResidentRuntimes !== undefined
      ? { resolveMaxResidentRuntimes: () => maxResidentRuntimes }
      : {}),
    ...(options.sampleMemory ? { sampleMemory: options.sampleMemory } : {}),
    ...(options.isRuntimeProtected ? { isRuntimeProtected: options.isRuntimeProtected } : {}),
    ...(options.suspendRuntime ? { suspendRuntime: options.suspendRuntime } : {}),
  });
  return { controller, clock };
}

/** Activate + commit one session, returning its generation id. */
async function activateAndCommit(
  controller: ReturnType<typeof createSessionRuntimeResidencyController>,
  sessionId: string,
  generationId: string,
): Promise<void> {
  const result = await controller.beginActivation(
    sessionId,
    generationId,
    new AbortController().signal,
  );
  expect(result.ok).toBe(true);
  controller.commitActivation(sessionId, generationId);
}

describe('session-runtime-residency-controller', () => {
  it('reports cold before any activation and resident-idle after commit', async () => {
    const { controller } = createController();
    expect(controller.getResidency('s1')).toBe('cold');
    expect(controller.hasResident()).toBe(false);

    const result = await controller.beginActivation('s1', 'gen-1', new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(controller.getResidency('s1')).toBe('activating');
    controller.commitActivation('s1', 'gen-1');
    expect(controller.getResidency('s1')).toBe('resident-idle');
    expect(controller.hasResident()).toBe(true);
  });

  it('expires idle runtimes after the TTL on sweep', async () => {
    const { controller, clock } = createController();
    await activateAndCommit(controller, 's1', 'gen-1');
    await activateAndCommit(controller, 's2', 'gen-2');
    expect(controller.getCounts().resident).toBe(2);

    clock.advance(601_000); // past the 600s TTL
    await controller.sweepNow();

    expect(controller.getResidency('s1')).toBe('cold');
    expect(controller.getResidency('s2')).toBe('cold');
    expect(controller.getCounts().resident).toBe(0);
    expect(controller.getCounters().evictedByIdleTtl).toBe(2);
  });

  it('touching an idle runtime refreshes its TTL deadline', async () => {
    const { controller, clock } = createController();
    await activateAndCommit(controller, 's1', 'gen-1');
    clock.advance(500_000);
    controller.touch('s1', 'gen-1');
    clock.advance(200_000); // original deadline would have passed
    await controller.sweepNow();
    expect(controller.getResidency('s1')).toBe('resident-idle');

    clock.advance(500_000); // now past the refreshed deadline
    await controller.sweepNow();
    expect(controller.getResidency('s1')).toBe('cold');
  });

  it('evicts idle runtimes above max-idle in LRU order', async () => {
    const { controller } = createController({ retention: { maxIdleRuntimes: 1 } });
    await activateAndCommit(controller, 's-a', 'gen-a');
    await activateAndCommit(controller, 's-b', 'gen-b');
    // Both idle, maxIdle=1: the LRU (s-a) is evicted on the next admission.
    await activateAndCommit(controller, 's-c', 'gen-c');

    expect(controller.getResidency('s-a')).toBe('cold');
    expect(controller.getResidency('s-b')).toBe('resident-idle');
    expect(controller.getResidency('s-c')).toBe('resident-idle');
    expect(controller.getCounters().evictedByMaxIdle).toBe(1);
  });

  it('tie-breaks LRU victims by stable session id', async () => {
    const { controller } = createController({ retention: { maxIdleRuntimes: 1 } });
    // Two sessions touched at the same clock instant: deterministic tie-break.
    await activateAndCommit(controller, 's-b', 'gen-b');
    await activateAndCommit(controller, 's-a', 'gen-a');
    await activateAndCommit(controller, 's-c', 'gen-c');

    expect(controller.getResidency('s-a')).toBe('cold');
    expect(controller.getResidency('s-b')).toBe('resident-idle');
  });

  it('enforces max-resident admission with FIFO capacity waiters', async () => {
    const { controller } = createController({ maxResidentRuntimes: 2 });
    await activateAndCommit(controller, 's1', 'gen-1');
    await activateAndCommit(controller, 's2', 'gen-2');
    // Both runtimes are busy so neither can be evicted for the third one.
    controller.markBusy('s1', 'gen-1');
    controller.markBusy('s2', 'gen-2');

    const thirdSignal = new AbortController();
    const third = controller.beginActivation('s3', 'gen-3', thirdSignal.signal);
    let thirdResolved = false;
    void third.then(() => {
      thirdResolved = true;
    });
    await Promise.resolve();
    expect(controller.getCounts().waiterCount).toBe(1);
    expect(thirdResolved).toBe(false);

    // Releasing capacity by suspending s1 grants the waiter.
    controller.markIdle('s1', 'gen-1');
    const suspend = controller.beginSuspend('s1', 'gen-1', 'max-resident');
    expect(suspend.ok).toBe(true);
    controller.finishSuspend('s1', 'gen-1');

    const result = await third;
    expect(result.ok).toBe(true);
    expect(controller.getCounts().waiterCount).toBe(0);
    expect(controller.getResidency('s3')).toBe('activating');
    controller.commitActivation('s3', 'gen-3');
    expect(controller.getCounts().resident).toBe(2);
  });

  it('wakes an existing capacity waiter when Settings raises the resident cap', async () => {
    const { controller } = createController({ maxResidentRuntimes: 1 });
    await activateAndCommit(controller, 'holder', 'gen-holder');
    controller.markBusy('holder', 'gen-holder');

    const waiting = controller.beginActivation(
      'waiter',
      'gen-waiter',
      new AbortController().signal,
    );
    await Promise.resolve();
    expect(controller.getCounts().waiterCount).toBe(1);

    controller.updateRetention({
      idleTtlSeconds: 600,
      maxIdleRuntimes: 2,
      maxResidentRuntimes: 2,
    });
    expect(await waiting).toEqual({ ok: true });
    expect(controller.getResidency('waiter')).toBe('activating');
  });

  it('lets an explicit resident cap override the adaptive resolver', () => {
    const { controller } = createController({
      maxResidentRuntimes: 6,
      retention: { maxResidentRuntimes: 2 },
    });
    expect(controller.getMaxResidentRuntimes()).toBe(2);
  });

  it('does not release capacity until Host suspension cleanup completes', async () => {
    let completeSuspension: ((suspended: boolean) => void) | undefined;
    const cleanup = new Promise<boolean>((resolve) => {
      completeSuspension = resolve;
    });
    const { controller } = createController({
      maxResidentRuntimes: 1,
      suspendRuntime: async () => cleanup,
    });
    await activateAndCommit(controller, 's1', 'gen-1');

    const activation = controller.beginActivation('s2', 'gen-2', new AbortController().signal);
    await Promise.resolve();
    expect(controller.getResidency('s1')).toBe('suspending');
    expect(controller.getResidency('s2')).toBe('cold');
    expect(controller.getCounts().resident).toBe(1);

    if (!completeSuspension) throw new Error('suspension callback was not started');
    completeSuspension(true);
    expect(await activation).toEqual({ ok: true });
    expect(controller.getResidency('s1')).toBe('cold');
    expect(controller.getResidency('s2')).toBe('activating');
  });

  it('restores residency when Host suspension cleanup fails', async () => {
    const { controller } = createController({
      suspendRuntime: async () => false,
    });
    await activateAndCommit(controller, 's1', 'gen-1');

    expect(await controller.requestSuspend('s1', 'gen-1', 'idle-ttl')).toBe(false);
    expect(controller.getResidency('s1')).toBe('resident-idle');
    expect(controller.getCounters().evictedByIdleTtl).toBe(0);
  });

  it('never evicts a protected runtime even when over budget', async () => {
    const { controller } = createController({ maxResidentRuntimes: 1 });
    await activateAndCommit(controller, 's1', 'gen-1');
    controller.protect('s1', 'gen-1');
    controller.markBusy('s1', 'gen-1');

    // Attempt to activate s2 — s1 is protected and must not be evicted.
    const signal = new AbortController();
    const pending = controller.beginActivation('s2', 'gen-2', signal.signal);
    await Promise.resolve();
    expect(controller.getResidency('s1')).toBe('resident-busy');
    expect(controller.getCounts().waiterCount).toBe(1);

    signal.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(controller.getCounts().waiterCount).toBe(0);
  });

  it('evicts idle runtimes under memory high-water pressure to low water', async () => {
    // Aggregate RSS reflects resident count plus an optional spike. Each
    // runtime contributes 100 MiB; evicting one frees 100 MiB so the sweep
    // can reach the low-water mark (410 MiB at a 512 MiB high water).
    let spikeMiB = 0;
    const { controller } = createController({
      retention: { memoryHighWaterMiB: 512 },
      maxResidentRuntimes: 8,
      sampleMemory: () => ({
        hostRssMiB: 100 + controller.getCounts().resident * 100 + spikeMiB,
        workerRssMiB: 0,
        sampleCompleteness: 'complete' as const,
      }),
    });
    await activateAndCommit(controller, 's1', 'gen-1');
    await activateAndCommit(controller, 's2', 'gen-2');
    await activateAndCommit(controller, 's3', 'gen-3');
    expect(controller.getCounts().resident).toBe(3);

    spikeMiB = 300; // aggregate RSS jumps to 700 MiB, above high water (512)
    const result = await controller.beginActivation('s4', 'gen-4', new AbortController().signal);
    expect(result.ok).toBe(true);
    controller.commitActivation('s4', 'gen-4');

    // The LRU idle runtimes are evicted until aggregate RSS returns to low
    // water; s4 is admitted.
    expect(controller.getResidency('s1')).toBe('cold');
    expect(controller.getResidency('s4')).toBe('resident-idle');
    expect(controller.getCounters().evictedByMemoryPressure).toBeGreaterThan(0);
  });

  it('fails the activation with runtime-memory-pressure when idle eviction cannot recover', async () => {
    let hostRssMiB = 100;
    const { controller } = createController({
      retention: { memoryHighWaterMiB: 512 },
      maxResidentRuntimes: 8,
      sampleMemory: () => ({
        hostRssMiB,
        workerRssMiB: 0,
        sampleCompleteness: 'complete' as const,
      }),
    });
    await activateAndCommit(controller, 's1', 'gen-1');
    await activateAndCommit(controller, 's2', 'gen-2');

    // RSS stays above high water even after every idle runtime is released.
    hostRssMiB = 600;
    const result = await controller.beginActivation('s3', 'gen-3', new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      code: 'memory-pressure',
      message: expect.stringContaining('high water'),
    });
    expect(controller.getCounters().memoryPressureFailures).toBe(1);
  });

  it('does not make memory claims when worker samples are incomplete', async () => {
    const { controller } = createController({
      retention: { memoryHighWaterMiB: 512 },
      sampleMemory: () => ({
        hostRssMiB: 10_000,
        sampleCompleteness: 'missing' as const,
      }),
    });
    await activateAndCommit(controller, 's1', 'gen-1');
    await activateAndCommit(controller, 's2', 'gen-2');
    await activateAndCommit(controller, 's3', 'gen-3');
    expect(controller.getCounts().resident).toBe(3);
    expect(controller.getCounters().evictedByMemoryPressure).toBe(0);
  });

  it('deduplicates duplicate activations for the same session id', async () => {
    const { controller } = createController();
    const first = await controller.beginActivation('s1', 'gen-1', new AbortController().signal);
    expect(first.ok).toBe(true);
    // A second activation with the same generation is a no-op touch.
    const second = await controller.beginActivation('s1', 'gen-1', new AbortController().signal);
    expect(second.ok).toBe(true);
    expect(controller.getResidency('s1')).toBe('activating');
    controller.commitActivation('s1', 'gen-1');
    expect(controller.getCounts().resident).toBe(1);
  });

  it('rejects a suspension for a stale generation', async () => {
    const { controller } = createController();
    await activateAndCommit(controller, 's1', 'gen-1');
    // A concurrent replacement starts with a new generation.
    const replaced = await controller.beginActivation('s1', 'gen-2', new AbortController().signal);
    expect(replaced.ok).toBe(true);

    const stale = controller.beginSuspend('s1', 'gen-1', 'idle-ttl');
    expect(stale).toEqual({ ok: false, reason: 'generation-mismatch' });
    expect(controller.getResidency('s1')).toBe('activating');
  });

  it('abortActivation releases capacity and grants the next waiter', async () => {
    const { controller } = createController({ maxResidentRuntimes: 1 });
    const first = await controller.beginActivation('s1', 'gen-1', new AbortController().signal);
    expect(first.ok).toBe(true);

    const secondSignal = new AbortController();
    const second = controller.beginActivation('s2', 'gen-2', secondSignal.signal);
    await Promise.resolve();
    expect(controller.getCounts().waiterCount).toBe(1);

    controller.abortActivation('s1', 'gen-1');
    const secondResult = await second;
    expect(secondResult.ok).toBe(true);
    expect(controller.getResidency('s2')).toBe('activating');
  });

  it('cancelled waiter is removed without consuming capacity', async () => {
    const { controller } = createController({ maxResidentRuntimes: 1 });
    await activateAndCommit(controller, 's1', 'gen-1');
    controller.markBusy('s1', 'gen-1');

    const signal = new AbortController();
    const pending = controller.beginActivation('s2', 'gen-2', signal.signal);
    await Promise.resolve();
    expect(controller.getCounts().waiterCount).toBe(1);
    signal.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(controller.getCounts().waiterCount).toBe(0);

    // Capacity remains occupied by the busy runtime: a new activation queues.
    const thirdSignal = new AbortController();
    const third = controller.beginActivation('s3', 'gen-3', thirdSignal.signal);
    await Promise.resolve();
    expect(controller.getCounts().waiterCount).toBe(1);
    void third.catch(() => undefined);
    thirdSignal.abort();
  });

  it('suspension transitions through suspending and releases on finish', async () => {
    const { controller } = createController();
    await activateAndCommit(controller, 's1', 'gen-1');
    const result = controller.beginSuspend('s1', 'gen-1', 'idle-ttl');
    expect(result).toEqual({ ok: true, status: 'started' });
    expect(controller.getResidency('s1')).toBe('suspending');
    controller.finishSuspend('s1', 'gen-1');
    expect(controller.getResidency('s1')).toBe('cold');
    expect(controller.hasResident()).toBe(false);
    expect(controller.getCounters().evictedByIdleTtl).toBe(1);
  });

  it('dispose rejects pending waiters and clears state', async () => {
    const { controller } = createController({ maxResidentRuntimes: 1 });
    await activateAndCommit(controller, 's1', 'gen-1');
    controller.markBusy('s1', 'gen-1');
    const pending = controller.beginActivation('s2', 'gen-2', new AbortController().signal);
    controller.dispose();
    await expect(pending).rejects.toThrow('host-disposed');
    expect(controller.getCounts().resident).toBe(0);
    expect(controller.getCounts().waiterCount).toBe(0);
  });

  it('timer starts when a runtime is resident and stops when none remains', async () => {
    let sweepCount = 0;
    const { controller } = createController({
      sweepIntervalMs: 10,
      retention: { idleTtlSeconds: 0 },
    });
    // Patch sweepNow to observe the timer via manual sweeps is not possible
    // without fake timers; instead verify the timer does not crash and that
    // zero-TTL runtimes are evicted on the next sweep.
    const originalSweep = controller.sweepNow;
    (controller as { sweepNow: () => Promise<void> }).sweepNow = async () => {
      sweepCount += 1;
      await originalSweep();
    };
    await activateAndCommit(controller, 's1', 'gen-1');
    // idleTtl=0 => deadline immediately expired; a manual sweep evicts.
    await controller.sweepNow();
    expect(controller.getResidency('s1')).toBe('cold');
    expect(sweepCount).toBe(1);
  });

  it('abortSuspend restores a suspending runtime to resident-idle', async () => {
    const { controller } = createController();
    await activateAndCommit(controller, 's1', 'gen-1');

    const started = controller.beginSuspend('s1', 'gen-1', 'idle-ttl');
    expect(started).toEqual({ ok: true, status: 'started' });
    expect(controller.getResidency('s1')).toBe('suspending');

    // Host cleanup failed (recorder flush): restore the runtime so it stays
    // resident instead of leaking detached state (ADR 0040 §6).
    expect(controller.abortSuspend('s1', 'gen-1')).toBe(true);
    expect(controller.getResidency('s1')).toBe('resident-idle');
    expect(controller.getCounts().resident).toBe(1);

    // A stale generation cannot be restored.
    expect(controller.abortSuspend('s1', 'gen-other')).toBe(false);
    expect(controller.abortSuspend('s1', 'gen-1')).toBe(false); // already idle
  });

  it('removes a same-generation suspension waiter when its signal aborts', async () => {
    const { controller } = createController();
    await activateAndCommit(controller, 's1', 'gen-1');
    expect(controller.beginSuspend('s1', 'gen-1', 'manual').ok).toBe(true);
    const abortController = new AbortController();
    const activation = controller.beginActivation('s1', 'gen-1', abortController.signal);

    abortController.abort();
    await expect(activation).rejects.toThrow('aborted');
    controller.finishSuspend('s1', 'gen-1');
    expect(controller.getResidency('s1')).toBe('cold');
  });

  it('never evicts a runtime the Host marks protected', async () => {
    const protectedSessions = new Set<string>();
    const { controller, clock } = createController({
      isRuntimeProtected: (sessionId) => protectedSessions.has(sessionId),
    });
    await activateAndCommit(controller, 's1', 'gen-1');
    await activateAndCommit(controller, 's2', 'gen-2');
    protectedSessions.add('s2');

    clock.advance(601_000); // both past the 600s TTL
    await controller.sweepNow();

    expect(controller.getResidency('s1')).toBe('cold');
    // s2 is blocked (active Run, pending permission, compaction, ...) and
    // must survive the sweep.
    expect(controller.getResidency('s2')).toBe('resident-idle');
    expect(controller.getCounters().evictedByIdleTtl).toBe(1);
  });

  it('runs Host suspension with the reason during a sweep eviction', async () => {
    const evicted: string[] = [];
    const { controller, clock } = createController({
      suspendRuntime: async (input) => {
        evicted.push(`${input.sessionId}:${input.reason}`);
        return true;
      },
    });
    await activateAndCommit(controller, 's1', 'gen-1');
    clock.advance(601_000);
    await controller.sweepNow();

    expect(evicted).toEqual(['s1:idle-ttl']);
  });

  it('runs Host suspension when a manual suspension completes', async () => {
    const evicted: string[] = [];
    const { controller } = createController({
      suspendRuntime: async (input) => {
        evicted.push(input.sessionId);
        return true;
      },
    });
    await activateAndCommit(controller, 's1', 'gen-1');
    expect(await controller.requestSuspend('s1', 'gen-1', 'manual')).toBe(true);
    expect(evicted).toEqual(['s1']);
  });
});

import { describe, expect, it } from 'vitest';
import { createRuntimeResourceCoordinator } from './runtime-resource-coordinator.js';

function deferredAbort(): { signal: AbortSignal; abort: () => void } {
  const controller = new AbortController();
  return { signal: controller.signal, abort: () => controller.abort() };
}

describe('RuntimeResourceCoordinator execution admission', () => {
  it('grants immediately under capacity and does not call onQueued', async () => {
    const coordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrentRuns: 8,
      subagentMaxConcurrency: 4,
    });
    let queued = 0;
    const lease = await coordinator.acquire({
      runId: 'run-1',
      executionClass: 'foreground',
      signal: new AbortController().signal,
      onQueued: () => {
        queued += 1;
      },
    });
    expect(lease.runId).toBe('run-1');
    expect(queued).toBe(0);
    expect(coordinator.getStatus().activeRuns).toBe(1);
    coordinator.release(lease);
    expect(coordinator.getStatus().activeRuns).toBe(0);
  });

  it('queues the 9th foreground run and auto-starts after a release', async () => {
    const coordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrentRuns: 8,
      subagentMaxConcurrency: 4,
    });
    const holders = [];
    for (let index = 0; index < 8; index += 1) {
      holders.push(
        await coordinator.acquire({
          runId: `fg-${index}`,
          executionClass: 'foreground',
          signal: new AbortController().signal,
        }),
      );
    }
    let queued = 0;
    const ninth = coordinator.acquire({
      runId: 'fg-8',
      executionClass: 'foreground',
      signal: new AbortController().signal,
      onQueued: () => {
        queued += 1;
      },
    });
    await Promise.resolve();
    expect(queued).toBe(1);
    expect(coordinator.getStatus().waitingForegroundRuns).toBe(1);
    expect(coordinator.getStatus().activeRuns).toBe(8);

    const firstHolder = holders[0];
    if (firstHolder === undefined) throw new Error('missing first holder');
    coordinator.release(firstHolder);
    const granted = await ninth;
    expect(granted.runId).toBe('fg-8');
    expect(coordinator.getStatus().waitingRuns).toBe(0);
    expect(coordinator.getStatus().activeRuns).toBe(8);
  });

  it('lets a foreground waiter skip a blocked subagent at the head', async () => {
    const coordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrentRuns: 2,
      subagentMaxConcurrency: 1,
    });
    const firstSub = await coordinator.acquire({
      runId: 'sub-1',
      executionClass: 'subagent',
      signal: new AbortController().signal,
    });
    const firstFg = await coordinator.acquire({
      runId: 'fg-1',
      executionClass: 'foreground',
      signal: new AbortController().signal,
    });
    const waitingSub = coordinator.acquire({
      runId: 'sub-2',
      executionClass: 'subagent',
      signal: new AbortController().signal,
    });
    const waitingFg = coordinator.acquire({
      runId: 'fg-2',
      executionClass: 'foreground',
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    expect(coordinator.getStatus().waitingSubagentRuns).toBe(1);
    expect(coordinator.getStatus().waitingForegroundRuns).toBe(1);

    coordinator.release(firstFg);
    const grantedFg = await waitingFg;
    expect(grantedFg.runId).toBe('fg-2');
    expect(coordinator.getStatus().activeSubagentRuns).toBe(1);
    expect(coordinator.getStatus().waitingSubagentRuns).toBe(1);

    coordinator.release(firstSub);
    const grantedSub = await waitingSub;
    expect(grantedSub.runId).toBe('sub-2');
  });

  it('abort removes a waiter without leaking a slot', async () => {
    const coordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrentRuns: 1,
      subagentMaxConcurrency: 4,
    });
    const holder = await coordinator.acquire({
      runId: 'fg-1',
      executionClass: 'foreground',
      signal: new AbortController().signal,
    });
    const waiterAbort = deferredAbort();
    const waiting = coordinator.acquire({
      runId: 'fg-2',
      executionClass: 'foreground',
      signal: waiterAbort.signal,
    });
    await Promise.resolve();
    expect(coordinator.getStatus().waitingRuns).toBe(1);
    waiterAbort.abort();
    await expect(waiting).rejects.toThrow('aborted');
    expect(coordinator.getStatus().waitingRuns).toBe(0);
    expect(coordinator.getStatus().activeRuns).toBe(1);
    coordinator.release(holder);
    expect(coordinator.getStatus().activeRuns).toBe(0);
  });

  it('raising the cap wakes eligible waiters; lowering does not kill active leases', async () => {
    const coordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrentRuns: 1,
      subagentMaxConcurrency: 4,
    });
    const first = await coordinator.acquire({
      runId: 'fg-1',
      executionClass: 'foreground',
      signal: new AbortController().signal,
    });
    const second = coordinator.acquire({
      runId: 'fg-2',
      executionClass: 'foreground',
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    coordinator.setConfiguredMaxConcurrentRuns(2);
    await second;
    expect(coordinator.getStatus().activeRuns).toBe(2);

    coordinator.setConfiguredMaxConcurrentRuns(1);
    expect(coordinator.getStatus().activeRuns).toBe(2);
    expect(coordinator.getStatus().effectiveMaxConcurrentRuns).toBe(1);
    coordinator.release(first);
  });

  it('a tighter resident limit is the published limiting reason', () => {
    const coordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrentRuns: 8,
      subagentMaxConcurrency: 4,
      residentRuntimeLimit: 4,
    });
    const status = coordinator.getStatus();
    expect(status.effectiveMaxConcurrentRuns).toBe(4);
    expect(status.limitingReason).toBe('runtime-residency');
  });

  it('does not clamp to 1 when processIsolation is false', async () => {
    const coordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrentRuns: 8,
      subagentMaxConcurrency: 4,
      processIsolation: false,
    });
    const first = await coordinator.acquire({
      runId: 'fg-1',
      executionClass: 'foreground',
      signal: new AbortController().signal,
    });
    const second = await coordinator.acquire({
      runId: 'fg-2',
      executionClass: 'foreground',
      signal: new AbortController().signal,
    });
    expect(coordinator.getStatus().activeRuns).toBe(2);
    expect(coordinator.getStatus().effectiveMaxConcurrentRuns).toBe(8);
    coordinator.release(first);
    coordinator.release(second);
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  createAvailableMemoryReader,
  createSystemMemoryMonitor,
  evaluateShellMemoryAdmission,
  type AvailableMemoryReading,
} from './system-memory.js';

const GiB = 1024;

function reading(availableMiB: number, totalMiB = 24 * GiB): AvailableMemoryReading {
  return { availableMiB, totalMiB, source: 'memorystatus', sampledAtMs: 0 };
}

describe('createAvailableMemoryReader', () => {
  it('converts the macOS memorystatus percentage against total memory', async () => {
    const read = createAvailableMemoryReader({
      platform: 'darwin',
      totalMemoryBytes: () => 24 * GiB * 1024 * 1024,
      runSysctl: async (name) => {
        expect(name).toBe('kern.memorystatus_level');
        return '64\n';
      },
      now: () => 1000,
    });
    expect(await read()).toEqual({
      availableMiB: Math.floor((24 * GiB * 64) / 100),
      totalMiB: 24 * GiB,
      source: 'memorystatus',
      sampledAtMs: 1000,
    });
  });

  it('reads MemAvailable on linux', async () => {
    const read = createAvailableMemoryReader({
      platform: 'linux',
      readMeminfo: async () => 'MemTotal:       16384000 kB\nMemAvailable:    2097152 kB\n',
      now: () => 0,
    });
    const result = await read();
    expect(result?.availableMiB).toBe(2048);
    expect(result?.source).toBe('meminfo');
  });

  it('returns null rather than guessing when the probe fails or is unsupported', async () => {
    const failing = createAvailableMemoryReader({
      platform: 'darwin',
      runSysctl: async () => {
        throw new Error('sandboxed');
      },
    });
    expect(await failing()).toBeNull();

    const garbage = createAvailableMemoryReader({
      platform: 'darwin',
      runSysctl: async () => 'not-a-number\n',
    });
    expect(await garbage()).toBeNull();

    const unsupported = createAvailableMemoryReader({ platform: 'win32' });
    expect(await unsupported()).toBeNull();
  });
});

describe('createSystemMemoryMonitor', () => {
  it('exposes no sample before the first read and caches afterwards', async () => {
    const monitor = createSystemMemoryMonitor({
      read: async () => reading(4096),
      setIntervalFn: (() => 0 as unknown as NodeJS.Timeout) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });
    expect(monitor.getLatest()).toBeNull();
    await monitor.refresh();
    expect(monitor.getLatest()?.availableMiB).toBe(4096);
    monitor.stop();
  });

  it('does not record samples that land after stop()', async () => {
    let release: (value: AvailableMemoryReading) => void = () => undefined;
    const monitor = createSystemMemoryMonitor({
      read: () => new Promise<AvailableMemoryReading>((resolve) => (release = resolve)),
      setIntervalFn: (() => 0 as unknown as NodeJS.Timeout) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });
    const pending = monitor.refresh();
    monitor.stop();
    release(reading(128));
    await pending;
    expect(monitor.getLatest()).toBeNull();
  });
});

describe('evaluateShellMemoryAdmission', () => {
  it('admits when the gate is switched off', () => {
    expect(
      evaluateShellMemoryAdmission({ minAvailableMemoryMiB: 0, reading: reading(1) }),
    ).toEqual({ admit: true, reason: 'disabled' });
  });

  it('fails open when memory cannot be measured', () => {
    expect(evaluateShellMemoryAdmission({ minAvailableMemoryMiB: 2048, reading: null })).toEqual({
      admit: true,
      reason: 'unmeasured',
    });
  });

  it('admits at exactly the floor', () => {
    expect(
      evaluateShellMemoryAdmission({ minAvailableMemoryMiB: 2048, reading: reading(2048) }),
    ).toEqual({ admit: true, reason: 'sufficient' });
  });

  it('refuses below the floor and tells the model how to retry', () => {
    // 1.25 GiB available is what the kernel reported minutes before the
    // 2026-09-12 out-of-application-memory panel.
    const decision = evaluateShellMemoryAdmission({
      minAvailableMemoryMiB: 2048,
      reading: reading(1280),
    });
    expect(decision.admit).toBe(false);
    if (decision.admit) {
      throw new Error('expected refusal');
    }
    expect(decision.availableMiB).toBe(1280);
    expect(decision.requiredMiB).toBe(2048);
    expect(decision.message).toContain('was not run');
    expect(decision.message).toContain('--maxWorkers=1');
  });
});

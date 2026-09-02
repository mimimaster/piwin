import { describe, expect, it } from 'vitest';
import type { HostRuntimeResourcesData } from '@piwin/contracts';
import { formatRuntimeResourcesLines } from './runtime-resources-format.js';

const sample: HostRuntimeResourcesData = {
  counts: {
    resident: 1,
    idle: 1,
    busy: 0,
    activating: 0,
    suspending: 0,
  },
  waiterCount: 0,
  budget: {
    maxResidentRuntimes: 5,
    maxIdleRuntimes: 2,
    memoryHighWaterMiB: 1024,
    memoryLowWaterMiB: 819,
  },
  memory: {
    hostRssMiB: 256,
    sampleCompleteness: 'missing',
  },
  counters: {
    evictedByIdleTtl: 0,
    evictedByMaxIdle: 0,
    evictedByMaxResident: 0,
    evictedByMemoryPressure: 0,
    memoryPressureFailures: 0,
  },
};

describe('formatRuntimeResourcesLines', () => {
  it('matches the pre-extract output when workers is absent', () => {
    expect(formatRuntimeResourcesLines(sample)).toEqual([
      'runtime residency: resident=1 idle=1 busy=0 activating=0 suspending=0 waiters=0',
      'runtime budget: maxResident=5 maxIdle=2 highWaterMiB=1024 lowWaterMiB=819',
      'runtime memory: hostRssMiB=256 sample=missing',
      'runtime evictions: ttl=0 maxIdle=0 maxResident=0 memory=0 pressureFail=0',
    ]);
  });

  it('appends a workers line using pool as the denominator', () => {
    const lines = formatRuntimeResourcesLines({
      ...sample,
      workers: {
        pool: 5,
        max: 6,
        active: 3,
        starting: 0,
        subagent: 2,
        subagentMax: 4,
        subagentWaiting: 1,
      },
    });
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe(
      'runtime workers: 3/5 active (0 starting) · subagents 2/4 · waiting 1',
    );
  });
});

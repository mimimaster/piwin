import { describe, expect, it, vi } from 'vitest';
import {
  applyWorkerPoolSize,
  buildWorkersResourceBlock,
  type WorkerPoolApplyTarget,
} from './worker-pool-policy.js';

function makeDeps(overrides: Partial<WorkerPoolApplyTarget> = {}): WorkerPoolApplyTarget & {
  setMax: ReturnType<typeof vi.fn>;
  setQuota: ReturnType<typeof vi.fn>;
  revisit: ReturnType<typeof vi.fn>;
  logs: Array<{ type: string; level: string; message: string }>;
} {
  const setMax = vi.fn();
  const setQuota = vi.fn();
  const revisit = vi.fn();
  const logs: Array<{ type: string; level: string; message: string }> = [];
  const deps: WorkerPoolApplyTarget & {
    setMax: typeof setMax;
    setQuota: typeof setQuota;
    revisit: typeof revisit;
    logs: typeof logs;
  } = {
    workerPoolSize: 0,
    supervisorMax: 0,
    subagentQuota: 0,
    workerPoolOverParallelismLogged: false,
    workerCapacityExhaustWarnLogged: false,
    agentWorkerSupervisor: { setMaxActiveWorkers: setMax },
    runtimeResourceCoordinator: { setConfiguredMaxConcurrency: setQuota },
    residencyController: { revisitCapacity: revisit },
    push: (message) => {
      if (message.type === 'host/log') logs.push(message);
    },
    setMax,
    setQuota,
    revisit,
    logs,
    ...overrides,
  };
  return deps;
}

describe('applyWorkerPoolSize', () => {
  it('applies N=4 as pool 5, supervisor 6, quota 4', () => {
    const deps = makeDeps();
    applyWorkerPoolSize(deps, 4, 16);
    expect(deps.setMax).toHaveBeenCalledOnce();
    expect(deps.setMax).toHaveBeenCalledWith(6);
    expect(deps.setQuota).toHaveBeenCalledOnce();
    expect(deps.setQuota).toHaveBeenCalledWith(4);
    expect(deps.revisit).toHaveBeenCalledOnce();
    expect(deps.workerPoolSize).toBe(5);
    expect(deps.supervisorMax).toBe(6);
    expect(deps.subagentQuota).toBe(4);
    expect(deps.logs).toEqual([]);
  });

  it('applies N=9 as pool 8, quota 7, supervisor 9', () => {
    const deps = makeDeps();
    applyWorkerPoolSize(deps, 9, 16);
    expect(deps.workerPoolSize).toBe(8);
    expect(deps.subagentQuota).toBe(7);
    expect(deps.supervisorMax).toBe(9);
    expect(deps.setMax).toHaveBeenCalledWith(9);
    expect(deps.setQuota).toHaveBeenCalledWith(7);
  });

  it('logs once when pool exceeds available parallelism', () => {
    const deps = makeDeps();
    applyWorkerPoolSize(deps, 4, 2);
    expect(deps.logs).toHaveLength(1);
    expect(deps.logs[0]?.level).toBe('info');
    applyWorkerPoolSize(deps, 7, 2);
    expect(deps.logs).toHaveLength(1);
  });

  it('does not throw in mock mode (null supervisor/coordinator)', () => {
    const deps = makeDeps({
      agentWorkerSupervisor: null,
      runtimeResourceCoordinator: null,
    });
    expect(() => applyWorkerPoolSize(deps, 4, 16)).not.toThrow();
    expect(deps.workerPoolSize).toBe(5);
    expect(deps.logs).toEqual([]);
  });

  it('treats undefined as default 4', () => {
    const deps = makeDeps();
    applyWorkerPoolSize(deps, undefined, 16);
    expect(deps.workerPoolSize).toBe(5);
    expect(deps.supervisorMax).toBe(6);
    expect(deps.subagentQuota).toBe(4);
  });
});

describe('buildWorkersResourceBlock', () => {
  it('is undefined without a supervisor and complete with one', () => {
    expect(
      buildWorkersResourceBlock({
        workerPoolSize: 5,
        subagentQuota: 4,
        supervisor: null,
        ephemeral: 0,
        subagentWaiting: 0,
      }),
    ).toBeUndefined();
    expect(
      buildWorkersResourceBlock({
        workerPoolSize: 5,
        subagentQuota: 4,
        supervisor: {
          getStatus: () => ({
            maxActiveWorkers: 6,
            activeWorkers: 3,
            startingWorkers: 0,
          }),
        },
        ephemeral: 2,
        subagentWaiting: 1,
      }),
    ).toEqual({
      pool: 5,
      max: 6,
      active: 3,
      starting: 0,
      subagent: 2,
      subagentMax: 4,
      subagentWaiting: 1,
    });
  });
});

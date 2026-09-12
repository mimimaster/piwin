import { describe, expect, it, vi } from 'vitest';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { RunRegistry } from '../run-registry.js';
import { failRunForToolLoopStall } from './tool-loop-breaker.js';

describe('failRunForToolLoopStall', () => {
  it('cancels the run and aborts the live session', () => {
    const registry = new RunRegistry();
    const run = registry.createForegroundRun('session-1');
    const abortLiveSession = vi.fn(async () => undefined);
    const pushes: unknown[] = [];
    failRunForToolLoopStall(
      {
        runRegistry: registry,
        abortLiveSession,
        push: (message: unknown) => {
          pushes.push(message);
        },
      } as unknown as HostRuntimeKernel,
      {
        sessionId: 'session-1',
        runId: run.runId,
        message: 'Host stopped this run: the agent searched without writing.',
      },
    );
    expect(registry.get(run.runId)?.status).toBe('cancelling');
    expect(registry.getSignal(run.runId)?.aborted).toBe(true);
    expect(abortLiveSession).toHaveBeenCalledWith('session-1');
  });

  it('ignores a run that is already terminal', () => {
    const registry = new RunRegistry();
    const run = registry.createForegroundRun('session-1');
    registry.requestCancel(run.runId);
    registry.terminate(run.runId, 'cancelled', 'cancelled');
    const abortLiveSession = vi.fn(async () => undefined);
    failRunForToolLoopStall(
      {
        runRegistry: registry,
        abortLiveSession,
        push: () => undefined,
      } as unknown as HostRuntimeKernel,
      {
        sessionId: 'session-1',
        runId: run.runId,
        message: 'stalled',
      },
    );
    expect(abortLiveSession).not.toHaveBeenCalled();
  });
});

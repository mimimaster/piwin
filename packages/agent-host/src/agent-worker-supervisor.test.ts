import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SUBAGENT_MAX_CONCURRENCY, deriveSupervisorMaxWorkers } from '@piwin/contracts';
import { AgentWorkerSupervisor, WorkerCapacityExhaustedError } from './agent-worker-supervisor.js';
import type { AgentWorkerRuntimeSettings } from './agent-worker-supervisor.js';

const HELLO_FRAME = {
  type: 'hello',
  protocolVersion: 1,
  workerPid: 1,
  capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
};

function helloScript(): string {
  return `(function(){var fs=require('fs'),b=require('buffer').Buffer.alloc(65536);try{while(fs.readSync(3,b,0,65536)>0){}}catch(e){}})(); process.stdout.write(${JSON.stringify(JSON.stringify(HELLO_FRAME))} + '\\n'); setInterval(() => {}, 1000);`;
}

function hangUntilStdinHelloScript(): string {
  return `process.stdin.resume(); process.stdin.once('data', () => { process.stdout.write(${JSON.stringify(JSON.stringify(HELLO_FRAME))} + '\\n'); }); setInterval(() => {}, 1000);`;
}

function ignoreSigtermHelloScript(): string {
  return `(function(){var fs=require('fs'),b=require('buffer').Buffer.alloc(65536);try{while(fs.readSync(3,b,0,65536)>0){}}catch(e){}})(); process.stdout.write(${JSON.stringify(JSON.stringify(HELLO_FRAME))} + '\\n'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
}

function createSupervisor(
  settings: Partial<AgentWorkerRuntimeSettings> = { maxActiveWorkers: 4 },
  script = helloScript(),
): AgentWorkerSupervisor {
  return new AgentWorkerSupervisor({
    settings,
    worker: {
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', script],
    },
  });
}

describe('AgentWorkerSupervisor', () => {
  it('reuses only the exact session/generation pair', async () => {
    const supervisor = createSupervisor();
    const first = await supervisor.acquireWorker('session-1', 'generation-1');
    const samePair = await supervisor.acquireWorker('session-1', 'generation-1');
    const nextGeneration = await supervisor.acquireWorker('session-1', 'generation-2');

    expect(samePair).toBe(first);
    expect(nextGeneration).not.toBe(first);
    expect(supervisor.getStatus().activeWorkers).toBe(2);

    await supervisor.dispose();
    expect(supervisor.getStatus().activeWorkers).toBe(0);
  }, 10_000);

  it('rejects a new pair when worker capacity is exhausted', async () => {
    const supervisor = createSupervisor({ maxActiveWorkers: 1 });
    await supervisor.acquireWorker('session-1', 'generation-1');
    await expect(supervisor.acquireWorker('session-2', 'generation-1')).rejects.toThrow(
      /worker capacity exhausted/,
    );
    await supervisor.dispose();
  }, 10_000);

  it('defaults maxActiveWorkers to deriveSupervisorMaxWorkers(DEFAULT)', () => {
    const supervisor = new AgentWorkerSupervisor();
    expect(supervisor.getStatus().maxActiveWorkers).toBe(
      deriveSupervisorMaxWorkers(DEFAULT_SUBAGENT_MAX_CONCURRENCY),
    );
  });

  it('setMaxActiveWorkers clamps and does not kill live workers', async () => {
    const supervisor = createSupervisor({ maxActiveWorkers: 2 });
    try {
      await supervisor.acquireWorker('session-1', 'generation-1');
      await supervisor.acquireWorker('session-2', 'generation-1');
      supervisor.setMaxActiveWorkers(3);
      expect(supervisor.getStatus().maxActiveWorkers).toBe(3);
      supervisor.setMaxActiveWorkers(0);
      expect(supervisor.getStatus().maxActiveWorkers).toBe(1);
      supervisor.setMaxActiveWorkers(100);
      expect(supervisor.getStatus().maxActiveWorkers).toBe(9);
      supervisor.setMaxActiveWorkers(1);
      expect(supervisor.getStatus().activeWorkers).toBe(2);
      await expect(supervisor.acquireWorker('session-3', 'generation-1')).rejects.toThrow(
        WorkerCapacityExhaustedError,
      );
    } finally {
      await supervisor.dispose();
    }
  }, 10_000);

  it('counts an in-flight start against capacity', async () => {
    const supervisor = createSupervisor(
      { maxActiveWorkers: 1, startupTimeoutMs: 30_000 },
      hangUntilStdinHelloScript(),
    );
    const first = supervisor.acquireWorker('session-1', 'generation-1');
    const firstSettled = first.catch(() => undefined);
    try {
      expect(supervisor.getStatus().startingWorkers).toBe(1);
      try {
        await supervisor.acquireWorker('session-2', 'generation-1');
        expect.fail('expected capacity error');
      } catch (error) {
        expect(error).toBeInstanceOf(WorkerCapacityExhaustedError);
        const exhausted = error as WorkerCapacityExhaustedError;
        expect(exhausted.active).toBe(0);
        expect(exhausted.starting).toBe(1);
        expect(exhausted.max).toBe(1);
        expect(exhausted.message).toMatch(/worker capacity exhausted/);
        expect(exhausted.message).toMatch(/starting/);
      }
    } finally {
      await supervisor.dispose();
      await firstSettled;
    }
  }, 10_000);

  it('releaseWorker resolves even when the worker ignores SIGTERM', async () => {
    const supervisor = createSupervisor(
      { maxActiveWorkers: 1, shutdownTimeoutMs: 250 },
      ignoreSigtermHelloScript(),
    );
    try {
      await supervisor.acquireWorker('session-1', 'generation-1');
      const start = Date.now();
      await supervisor.releaseWorker('session-1', 'generation-1');
      expect(Date.now() - start).toBeLessThan(5_000);
      expect(supervisor.getStatus().activeWorkers).toBe(0);
      // The freed pair must be immediately reusable, not pinned by a hung close.
      await supervisor.acquireWorker('session-2', 'generation-1');
    } finally {
      await supervisor.dispose();
    }
  }, 10_000);

  it('keeps a replacement mapped when the released worker exits late', async () => {
    const supervisor = createSupervisor({ maxActiveWorkers: 1, shutdownTimeoutMs: 25 });
    const first = await supervisor.acquireWorker('session-1', 'generation-1');
    const closeSpy = vi.spyOn(first, 'close').mockImplementation(() => new Promise(() => {}));
    const forceKillSpy = vi.spyOn(first, 'forceKill').mockImplementation(() => {});

    try {
      await supervisor.releaseWorker('session-1', 'generation-1');
      const replacement = await supervisor.acquireWorker('session-1', 'generation-1');
      expect(replacement).not.toBe(first);

      first.emit('exit', null);

      expect(supervisor.getWorker('session-1', 'generation-1')).toBe(replacement);
      expect(supervisor.getStatus().activeWorkers).toBe(1);
    } finally {
      closeSpy.mockRestore();
      forceKillSpy.mockRestore();
      first.forceKill();
      await Promise.allSettled([first.close(), supervisor.dispose()]);
    }
  }, 10_000);
});

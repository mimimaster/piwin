import { describe, expect, it } from 'vitest';
import { AgentWorkerSupervisor } from './agent-worker-supervisor.js';

function createSupervisor(): AgentWorkerSupervisor {
  const hello = JSON.stringify({
    type: 'hello',
    protocolVersion: 1,
    workerPid: 1,
    capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
  });
  return new AgentWorkerSupervisor({
    settings: { maxActiveWorkers: 4 },
    worker: {
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', `process.stdout.write(${JSON.stringify(hello)} + '\\n'); setInterval(() => {}, 1000);`],
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
    const supervisor = new AgentWorkerSupervisor({
      settings: { maxActiveWorkers: 1 },
      worker: {
        workerScript: 'unused-worker-script',
        nodeArgs: [
          '-e',
          `process.stdout.write(${JSON.stringify(JSON.stringify({
            type: 'hello',
            protocolVersion: 1,
            workerPid: 1,
            capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
          }))} + '\\n'); setInterval(() => {}, 1000);`,
        ],
      },
    });
    await supervisor.acquireWorker('session-1', 'generation-1');
    await expect(supervisor.acquireWorker('session-2', 'generation-1')).rejects.toThrow(
      /worker capacity exhausted/,
    );
    await supervisor.dispose();
  }, 10_000);
});

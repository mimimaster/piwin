import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProcessRegistry } from './process-registry.js';

async function makeTrustedProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-proc-proj-'));
  await writeFile(join(dir, 'marker.txt'), 'ok\n', 'utf8');
  return dir;
}

describe('ProcessRegistry', () => {
  it('rejects cwd outside trusted projects', async () => {
    const trusted = await makeTrustedProject();
    const registry = createProcessRegistry({
      config: { enabled: true, maxProcesses: 8 },
      getTrustedProjectRoots: () => [trusted],
    });
    await expect(
      registry.start({
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        cwd: tmpdir(),
      }),
    ).rejects.toThrow(/outside trusted/);
    await registry.dispose();
  });

  it('enforces maxProcesses', async () => {
    const trusted = await makeTrustedProject();
    const registry = createProcessRegistry({
      config: { enabled: true, maxProcesses: 1, killOnHostDispose: true },
      getTrustedProjectRoots: () => [trusted],
      killGraceMs: 500,
    });
    const first = await registry.start({
      command: process.execPath,
      argv: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: trusted,
    });
    expect(first.status).toBe('running');
    await expect(
      registry.start({
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        cwd: trusted,
      }),
    ).rejects.toThrow(/maxProcesses/);
    await registry.stop(first.id);
    await registry.dispose();
  });

  it('starts, lists, logs, and stops a long-running process', async () => {
    const trusted = await makeTrustedProject();
    const events: string[] = [];
    const registry = createProcessRegistry({
      config: { enabled: true, maxProcesses: 8, killOnHostDispose: true },
      getTrustedProjectRoots: () => [trusted],
      killGraceMs: 800,
      logThrottleMs: 10,
      onEvent: (event) => {
        events.push(event.type);
      },
    });

    const started = await registry.start({
      command: process.execPath,
      argv: [
        '-e',
        'console.log("hello-from-managed"); setInterval(() => {}, 1000)',
      ],
      cwd: trusted,
      label: 'sleeper',
    });
    expect(started.status).toBe('running');
    expect(typeof started.pid).toBe('number');

    await new Promise((resolve) => setTimeout(resolve, 200));
    const listed = registry.list();
    expect(listed.some((item) => item.id === started.id)).toBe(true);

    const logs = registry.readLogs({ processId: started.id });
    const joined = logs.map((chunk) => chunk.text).join('');
    expect(joined).toMatch(/hello-from-managed/);

    const stopped = await registry.stop(started.id);
    expect(stopped.status === 'stopped' || stopped.status === 'exited').toBe(true);
    expect(events).toContain('process/started');
    expect(events).toContain('process/exited');
    await registry.dispose();
  });

  it('stops only processes marked for session cleanup', async () => {
    const trusted = await makeTrustedProject();
    const registry = createProcessRegistry({
      config: { enabled: true, maxProcesses: 8, killOnHostDispose: true },
      getTrustedProjectRoots: () => [trusted],
      killGraceMs: 500,
    });
    const [boundProcess, persistentProcess] = await Promise.all([
      registry.start({
        command: process.execPath,
        argv: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: trusted,
        sessionId: 'session-1',
        killOnSessionEnd: true,
      }),
      registry.start({
        command: process.execPath,
        argv: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: trusted,
        sessionId: 'session-1',
        killOnSessionEnd: false,
      }),
    ]);

    const stopped = await registry.stopForSession('session-1');
    expect(stopped.map((processRecord) => processRecord.id)).toEqual([boundProcess.id]);
    expect(registry.get(boundProcess.id)?.status).toBe('stopped');
    expect(registry.get(persistentProcess.id)?.status).toBe('running');

    await registry.dispose();
  });

  it('dispose kills remaining children (no orphans)', async () => {
    const trusted = await makeTrustedProject();
    const registry = createProcessRegistry({
      config: { enabled: true, maxProcesses: 8, killOnHostDispose: true },
      getTrustedProjectRoots: () => [trusted],
      killGraceMs: 500,
    });
    const started = await registry.start({
      command: process.execPath,
      argv: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: trusted,
    });
    const pid = started.pid;
    expect(typeof pid).toBe('number');
    await registry.dispose();
    if (typeof pid === 'number') {
      let stillAlive = true;
      try {
        process.kill(pid, 0);
      } catch {
        stillAlive = false;
      }
      if (stillAlive) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        try {
          process.kill(pid, 0);
          stillAlive = true;
        } catch {
          stillAlive = false;
        }
      }
      expect(stillAlive).toBe(false);
    }
  });

  it('redacts secret-like values in process logs', async () => {
    const trusted = await makeTrustedProject();
    const registry = createProcessRegistry({
      config: { enabled: true },
      getTrustedProjectRoots: () => [trusted],
      killGraceMs: 500,
    });
    const started = await registry.start({
      command: process.execPath,
      argv: ['-e', 'console.log("API_KEY=super-secret-value"); process.exit(0)'],
      cwd: trusted,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const logs = registry.readLogs({ processId: started.id });
    const joined = logs.map((chunk) => chunk.text).join('');
    expect(joined).toMatch(/API_KEY=\*\*\*/);
    expect(joined).not.toMatch(/super-secret-value/);
    await registry.dispose();
  });
});

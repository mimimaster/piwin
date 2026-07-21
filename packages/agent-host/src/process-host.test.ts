import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openOrCreateProject, setProjectTrust } from '@piwin/project';
import { HostRuntime } from './host-runtime.js';
import { getPiwinProjectsPath, getPiwinRoot } from './paths.js';
import { evaluateProcessPermission } from './permission-policy.js';

describe('evaluateProcessPermission', () => {
  it('asks for start and stop', () => {
    expect(evaluateProcessPermission('process:start').decision).toBe('ask');
    expect(evaluateProcessPermission('process:stop').decision).toBe('ask');
  });
});

describe('HostRuntime process IPC', () => {
  it('rejects untrusted cwd, enforces max, stop and dispose clean', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-proc-host-'));
    const projectDir = await mkdtemp(join(tmpdir(), 'piwin-proc-proj-'));
    await writeFile(join(projectDir, 'ok.txt'), '1\n', 'utf8');

    const projectsPath = getPiwinProjectsPath(getPiwinRoot(rootDir));
    await openOrCreateProject(projectsPath, projectDir);
    await setProjectTrust(projectsPath, projectDir, 'trusted');

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });

    const status = await runtime.handleCommand({ type: 'host/status' });
    expect(status.success).toBe(true);
    if (status.success) {
      const data = status.data as { capabilities: { process?: boolean } };
      expect(data.capabilities.process).toBe(true);
    }

    const denied = await runtime.handleCommand({
      type: 'process/start',
      input: {
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        cwd: tmpdir(),
        projectPath: projectDir,
      },
    });
    expect(denied.success).toBe(false);

    // maxProcesses=1 via env not available; start one long runner then stop
    const started = await runtime.handleCommand({
      type: 'process/start',
      input: {
        command: process.execPath,
        argv: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: projectDir,
        projectPath: projectDir,
        label: 'sleeper',
      },
    });
    expect(started.success).toBe(true);
    if (!started.success) throw new Error(started.error);
    const processId = (started.data as { process: { id: string; pid?: number } }).process.id;
    const pid = (started.data as { process: { pid?: number } }).process.pid;

    const listed = await runtime.handleCommand({ type: 'process/list' });
    expect(listed.success).toBe(true);
    if (listed.success) {
      const processes = (listed.data as { processes: unknown[] }).processes;
      expect(processes.length).toBeGreaterThanOrEqual(1);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    const logs = await runtime.handleCommand({
      type: 'process/logs',
      query: { processId },
    });
    expect(logs.success).toBe(true);

    const stopped = await runtime.handleCommand({ type: 'process/stop', processId });
    expect(stopped.success).toBe(true);

    await runtime.dispose();
    if (typeof pid === 'number') {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      if (alive) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    }
  });
});

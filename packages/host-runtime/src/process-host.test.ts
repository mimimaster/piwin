import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openOrCreateProject, setProjectTrust } from '@piwin/project';
import { HostRuntime } from './host-runtime.js';
import { getPiwinProjectsPath, getPiwinRoot } from './paths.js';
import { evaluateProcessPermission } from './permission-policy.js';
import { createDefaultPiwinConfig, savePiwinConfig } from './config-store.js';

describe('evaluateProcessPermission', () => {
  it('asks for start and stop', () => {
    expect(evaluateProcessPermission('process:start').decision).toBe('ask');
    expect(evaluateProcessPermission('process:stop').decision).toBe('ask');
  });
});

describe('HostRuntime process IPC', () => {
  it('rejects untrusted cwd, enforces max, stop and dispose clean (job/*)', async () => {
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
      const data = status.data as { capabilities: { process?: boolean; jobs?: boolean } };
      expect(data.capabilities.process).toBe(true);
      expect(data.capabilities.jobs).toBe(true);
    }

    const denied = await runtime.handleCommand({
      type: 'job/start',
      input: {
        kind: 'command',
        lifetime: 'session',
        command: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        cwd: tmpdir(),
        ownerSessionId: 'test-session',
        ownerProjectPath: projectDir,
      },
    });
    expect(denied.success).toBe(false);

    // Start one long runner then stop
    const started = await runtime.handleCommand({
      type: 'job/start',
      input: {
        kind: 'service',
        lifetime: 'session',
        command: process.execPath,
        argv: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: projectDir,
        ownerSessionId: 'test-session',
        ownerProjectPath: projectDir,
        label: 'sleeper',
      },
    });
    expect(started.success).toBe(true);
    if (!started.success) throw new Error(started.error);
    const jobId = (started.data as { job: { jobId: string; processId?: number } }).job.jobId;
    const pid = (started.data as { job: { processId?: number } }).job.processId;

    const listed = await runtime.handleCommand({ type: 'job/list' });
    expect(listed.success).toBe(true);
    if (listed.success) {
      const jobs = (listed.data as { jobs: unknown[] }).jobs;
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    const logs = await runtime.handleCommand({
      type: 'job/logs',
      input: { jobId },
    });
    expect(logs.success).toBe(true);

    const stopped = await runtime.handleCommand({ type: 'job/stop', jobId });
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

  it('derives Job admission policy from settings (maxProcesses / enabled)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-proc-policy-'));
    const projectDir = await mkdtemp(join(tmpdir(), 'piwin-proc-policy-proj-'));
    await writeFile(join(projectDir, 'ok.txt'), '1\n', 'utf8');

    const projectsPath = getPiwinProjectsPath(getPiwinRoot(rootDir));
    await openOrCreateProject(projectsPath, projectDir);
    await setProjectTrust(projectsPath, projectDir, 'trusted');

    // maxProcesses=1 tightens admission for new Jobs without touching
    // already-running ones.
    const config = createDefaultPiwinConfig();
    config.process = { enabled: true, maxProcesses: 1 };
    await savePiwinConfig(config, rootDir);

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const first = await runtime.handleCommand({
        type: 'job/start',
        input: {
          kind: 'service',
          lifetime: 'session',
          command: process.execPath,
          argv: ['-e', 'setInterval(() => {}, 1000)'],
          cwd: projectDir,
          ownerSessionId: 'policy-session',
        },
      });
      expect(first.success).toBe(true);

      const second = await runtime.handleCommand({
        type: 'job/start',
        input: {
          kind: 'command',
          lifetime: 'session',
          command: process.execPath,
          argv: ['-e', 'process.exit(0)'],
          cwd: projectDir,
          ownerSessionId: 'policy-session',
        },
      });
      expect(second.success).toBe(false);
      if (!second.success) {
        expect(second.error).toMatch(/maxJobs reached/);
      }
    } finally {
      await runtime.dispose();
    }

    // enabled=false blocks new Jobs entirely.
    const disabledConfig = createDefaultPiwinConfig();
    disabledConfig.process = { enabled: false, maxProcesses: 8 };
    await savePiwinConfig(disabledConfig, rootDir);

    const disabledRuntime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const denied = await disabledRuntime.handleCommand({
        type: 'job/start',
        input: {
          kind: 'command',
          lifetime: 'session',
          command: process.execPath,
          argv: ['-e', 'process.exit(0)'],
          cwd: projectDir,
          ownerSessionId: 'policy-session',
        },
      });
      expect(denied.success).toBe(false);
      if (!denied.success) {
        expect(denied.error).toMatch(/disabled by settings/);
      }
    } finally {
      await disabledRuntime.dispose();
    }
  });
});

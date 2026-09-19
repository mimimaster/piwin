import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createProcessSupervisor } from './process-supervisor.js';

async function makeTrustedProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'piwin-supervisor-test-'));
}

async function waitForProcessToExit(processId: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`process ${processId} did not exit within ${timeoutMs}ms`);
}

describe('ProcessSupervisor', () => {
  it('waits for a child to exit before stop resolves', async () => {
    const trustedProject = await makeTrustedProject();
    const supervisor = createProcessSupervisor({
      killGraceMs: 50,
      finalWaitMs: 100,
    });
    const target = await supervisor.spawn({
      command: process.execPath,
      argv: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: trustedProject,
      trustedProjectRoots: [trustedProject],
    });

    await supervisor.stop(target);

    expect(target.child.exitCode === null && target.child.signalCode === null).toBe(false);
    await supervisor.dispose();
  });

  it('handles a child that exits nonzero without treating killed as exited', async () => {
    const trustedProject = await makeTrustedProject();
    const supervisor = createProcessSupervisor({
      killGraceMs: 50,
      finalWaitMs: 100,
    });
    const target = await supervisor.spawn({
      command: process.execPath,
      argv: ['-e', 'process.exit(7)'],
      cwd: trustedProject,
      trustedProjectRoots: [trustedProject],
    });

    await new Promise<void>((resolve) => {
      target.child.once('close', () => resolve());
    });

    expect(target.child.exitCode).toBe(7);
    await supervisor.stop(target);
    await supervisor.dispose();
  });

  it('reaps descendants after the process-group leader exits', async () => {
    if (process.platform === 'win32') return;

    const trustedProject = await makeTrustedProject();
    const supervisor = createProcessSupervisor({
      killGraceMs: 50,
      finalWaitMs: 200,
    });
    const parentScript = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'console.log(String(child.pid));',
      'setTimeout(() => process.exit(0), 50);',
    ].join(' ');
    const target = await supervisor.spawn({
      command: process.execPath,
      argv: ['-e', parentScript],
      cwd: trustedProject,
      trustedProjectRoots: [trustedProject],
    });

    const descendantPid = await new Promise<number>((resolve, reject) => {
      let output = '';
      target.child.stdout?.setEncoding('utf8');
      target.child.stdout?.on('data', (chunk: string) => {
        output += chunk;
        const pid = Number.parseInt(output.trim(), 10);
        if (Number.isInteger(pid) && pid > 0) resolve(pid);
      });
      target.child.once('error', reject);
    });

    await new Promise<void>((resolve) => target.child.once('close', () => resolve()));
    await waitForProcessToExit(descendantPid);
    await supervisor.dispose();
  });
});

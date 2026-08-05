import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createProcessSupervisor } from './process-supervisor.js';

async function makeTrustedProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'piwin-supervisor-test-'));
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
});

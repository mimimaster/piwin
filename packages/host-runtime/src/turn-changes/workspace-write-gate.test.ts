import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceWriteGate } from './workspace-write-gate.js';

const temporaryDirectories: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe('createWorkspaceWriteGate', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('rejects overlapping same-path acquires with workspace-busy', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-');
    const gate = createWorkspaceWriteGate();

    const first = await gate.tryAcquire({
      workspaceId: 'ws-1',
      rootPath,
      kind: 'tool',
      runId: 'run-1',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('expected first acquire to succeed');
    }

    const overlapping = await gate.tryAcquire({
      workspaceId: 'ws-1',
      rootPath,
      kind: 'git',
    });
    expect(overlapping).toEqual({ ok: false, reason: 'workspace-busy' });

    first.lease.release();
    const afterRelease = await gate.tryAcquire({
      workspaceId: 'ws-1',
      rootPath,
      kind: 'integration',
    });
    expect(afterRelease.ok).toBe(true);
    if (afterRelease.ok) {
      afterRelease.lease.release();
    }
  });

  it('lets only one of two concurrent same-path tryAcquire calls win', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-race-');
    const gate = createWorkspaceWriteGate();
    const input = {
      workspaceId: 'ws-race',
      rootPath,
      kind: 'tool' as const,
    };

    const [left, right] = await Promise.all([gate.tryAcquire(input), gate.tryAcquire(input)]);
    const winners = [left, right].filter((result) => result.ok);
    const losers = [left, right].filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0];
    if (!loser || loser.ok) {
      throw new Error('expected one workspace-busy loser');
    }
    expect(loser.reason).toBe('workspace-busy');
    const winner = winners[0];
    if (winner && winner.ok) {
      winner.lease.release();
    }
  });

  it('treats symlink aliases of the same realpath as one workspace', async () => {
    const realRoot = await createTempDir('piwin-ws-gate-real-');
    const aliasDir = await createTempDir('piwin-ws-gate-alias-');
    const alias = join(aliasDir, 'link');
    await symlink(realRoot, alias);
    const gate = createWorkspaceWriteGate();

    const first = await gate.tryAcquire({
      workspaceId: 'ws-real',
      rootPath: realRoot,
      kind: 'tool',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('expected realpath acquire to succeed');
    }
    expect(first.lease.workspaceId).toBe('ws-real');
    expect(realpathSync(alias)).toBe(realpathSync(realRoot));

    const viaAlias = await gate.tryAcquire({
      workspaceId: 'ws-alias',
      rootPath: alias,
      kind: 'git',
    });
    expect(viaAlias).toEqual({ ok: false, reason: 'workspace-busy' });
    first.lease.release();
  });

  it('allows concurrent acquires on distinct workspace roots', async () => {
    const firstRoot = await createTempDir('piwin-ws-gate-a-');
    const secondRoot = await createTempDir('piwin-ws-gate-b-');
    await mkdir(join(firstRoot, 'nested'), { recursive: true });
    const gate = createWorkspaceWriteGate();

    const [left, right] = await Promise.all([
      gate.tryAcquire({ workspaceId: 'ws-a', rootPath: firstRoot, kind: 'tool' }),
      gate.tryAcquire({ workspaceId: 'ws-b', rootPath: secondRoot, kind: 'git' }),
    ]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (left.ok) left.lease.release();
    if (right.ok) right.lease.release();
  });
});

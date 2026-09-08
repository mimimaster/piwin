import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceWriteGate } from './workspace-write-gate.js';
import { workspaceRootsOverlap } from './workspace-root.js';

const temporaryDirectories: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('createWorkspaceWriteGate', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('queues overlapping exclusive acquires until the holder releases', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-');
    const gate = createWorkspaceWriteGate();
    const first = await gate.tryAcquire({
      workspaceId: 'ws-1',
      rootPath,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
      runId: 'run-1',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('expected first acquire to succeed');
    }

    let secondResolved = false;
    const secondPromise = gate.tryAcquire({
      workspaceId: 'ws-1',
      rootPath,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    });
    void secondPromise.then(() => {
      secondResolved = true;
    });
    await delay(20);
    expect(secondResolved).toBe(false);

    first.lease.release();
    const second = await secondPromise;
    expect(second.ok).toBe(true);
    if (second.ok) {
      second.lease.release();
    }
  });

  it('returns workspace-busy for wait:false while a lease is held', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-busy-');
    const gate = createWorkspaceWriteGate();
    const first = await gate.tryAcquire({
      workspaceId: 'ws-1',
      rootPath,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('expected first acquire to succeed');
    }
    const overlapping = await gate.tryAcquire({
      workspaceId: 'ws-1',
      rootPath,
      kind: 'undo',
      mode: 'exclusive',
      wait: false,
    });
    expect(overlapping).toEqual({ ok: false, reason: 'workspace-busy' });
    first.lease.release();
  });

  it('lets only one of two concurrent wait:false acquires win', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-race-');
    const gate = createWorkspaceWriteGate();
    const input = {
      workspaceId: 'ws-race',
      rootPath,
      kind: 'tool' as const,
      mode: 'exclusive' as const,
      wait: false,
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
      mode: 'exclusive',
      wait: true,
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
      kind: 'undo',
      mode: 'exclusive',
      wait: false,
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
      gate.tryAcquire({
        workspaceId: 'ws-a',
        rootPath: firstRoot,
        kind: 'tool',
        mode: 'exclusive',
        wait: true,
      }),
      gate.tryAcquire({
        workspaceId: 'ws-b',
        rootPath: secondRoot,
        kind: 'git',
        mode: 'exclusive',
        wait: true,
      }),
    ]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (left.ok) left.lease.release();
    if (right.ok) right.lease.release();
  });

  it('conflicts exclusive leases on ancestor and descendant roots', async () => {
    const parentRoot = await createTempDir('piwin-ws-gate-parent-');
    const childRoot = join(parentRoot, 'packages', 'foo');
    await mkdir(childRoot, { recursive: true });
    expect(workspaceRootsOverlap(parentRoot, childRoot)).toBe(true);
    const neighbor = join(parentRoot, 'packages-extra');
    await mkdir(neighbor);
    expect(workspaceRootsOverlap(join(parentRoot, 'packages'), neighbor)).toBe(false);

    const gate = createWorkspaceWriteGate();
    const parent = await gate.tryAcquire({
      workspaceId: 'ws-parent',
      rootPath: parentRoot,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    });
    expect(parent.ok).toBe(true);
    const child = await gate.tryAcquire({
      workspaceId: 'ws-child',
      rootPath: childRoot,
      kind: 'tool',
      mode: 'exclusive',
      wait: false,
    });
    expect(child).toEqual({ ok: false, reason: 'workspace-busy' });
    if (parent.ok) {
      parent.lease.release();
    }
  });

  it('runs three exclusive waiters on one root without busy', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-three-');
    const gate = createWorkspaceWriteGate();
    const order: number[] = [];
    const runs = [1, 2, 3].map(async (index) => {
      const acquired = await gate.tryAcquire({
        workspaceId: 'ws',
        rootPath,
        kind: 'tool',
        mode: 'exclusive',
        wait: true,
      });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) {
        return;
      }
      order.push(index);
      acquired.lease.release();
    });
    await Promise.all(runs);
    expect(order).toHaveLength(3);
  });

  it('aborts a queued waiter and then grants the next request', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-abort-');
    const gate = createWorkspaceWriteGate();
    const first = await gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('expected holder');
    }
    const controller = new AbortController();
    const aborted = gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
      signal: controller.signal,
    });
    const third = gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    });
    controller.abort();
    expect(await aborted).toEqual({ ok: false, reason: 'aborted' });
    first.lease.release();
    const granted = await third;
    expect(granted.ok).toBe(true);
    if (granted.ok) {
      granted.lease.release();
    }
  });

  it('does not grant wait:false across an already queued waiter', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-no-cut-');
    const gate = createWorkspaceWriteGate();
    const first = await gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('expected holder');
    }
    const queued = gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    });
    const undo = await gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'undo',
      mode: 'exclusive',
      wait: false,
    });
    expect(undo).toEqual({ ok: false, reason: 'workspace-busy' });
    first.lease.release();
    const granted = await queued;
    expect(granted.ok).toBe(true);
    if (granted.ok) {
      granted.lease.release();
    }
  });

  it('release is idempotent', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-idem-');
    const gate = createWorkspaceWriteGate();
    const first = await gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('expected holder');
    }
    first.lease.release();
    first.lease.release();
    const second = await gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'git',
      mode: 'exclusive',
      wait: false,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      second.lease.release();
    }
  });

  it('lets shared writers on different files overlap and serializes the same file', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-shared-');
    const gate = createWorkspaceWriteGate();
    let bothHeld = false;
    const first = gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'shared',
      wait: true,
      paths: [join(rootPath, 'a.ts')],
    });
    const second = gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'shared',
      wait: true,
      paths: [join(rootPath, 'b.ts')],
    });
    const [left, right] = await Promise.all([first, second]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (left.ok && right.ok) {
      bothHeld = true;
      left.lease.release();
      right.lease.release();
    }
    expect(bothHeld).toBe(true);

    const sameA = await gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'shared',
      wait: true,
      paths: [join(rootPath, 'a.ts')],
    });
    expect(sameA.ok).toBe(true);
    if (!sameA.ok) {
      throw new Error('expected same-file holder');
    }
    let secondSameResolved = false;
    const sameBPromise = gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'shared',
      wait: true,
      paths: [join(rootPath, 'a.ts')],
    });
    void sameBPromise.then(() => {
      secondSameResolved = true;
    });
    await delay(20);
    expect(secondSameResolved).toBe(false);
    sameA.lease.release();
    const sameB = await sameBPromise;
    expect(sameB.ok).toBe(true);
    if (sameB.ok) {
      sameB.lease.release();
    }
  });

  it('keeps a later shared waiter behind an earlier exclusive waiter', async () => {
    const rootPath = await createTempDir('piwin-ws-gate-fair-');
    const gate = createWorkspaceWriteGate();
    const holder = await gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
    });
    expect(holder.ok).toBe(true);
    if (!holder.ok) {
      throw new Error('expected holder');
    }
    const order: string[] = [];
    const exclusiveWaiter = gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    }).then((result) => {
      order.push('exclusive');
      if (result.ok) {
        result.lease.release();
      }
      return result;
    });
    const sharedWaiter = gate.tryAcquire({
      workspaceId: 'ws',
      rootPath,
      kind: 'tool',
      mode: 'shared',
      wait: true,
      paths: [join(rootPath, 'a.ts')],
    }).then((result) => {
      order.push('shared');
      if (result.ok) {
        result.lease.release();
      }
      return result;
    });
    holder.lease.release();
    await Promise.all([exclusiveWaiter, sharedWaiter]);
    expect(order[0]).toBe('exclusive');
  });
});

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_WRITER_SLOT_ID,
  createWriterSlotPool,
  isWriterSlotBranch,
  isWriterSlotName,
  isWriterSlotWorktreePath,
  type WriterSlotGitPort,
} from './subagent-writer-slots.js';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-writer-slot-'));
  roots.push(root);
  return root;
}

type FakeGit = WriterSlotGitPort & {
  calls: string[];
  usable: boolean;
  /** Tree the slot's current contents would freeze to. */
  liveTree: string;
  removeFails: boolean;
};

function createFakeGit(storageRoot: string, usable = true): FakeGit {
  const calls: string[] = [];
  const worktreePath = (name: string): string => join(storageRoot, 'repo-key', name);
  const fake: FakeGit = {
    calls,
    usable,
    liveTree: 'base-tree',
    removeFails: false,
    async createWorktree(input) {
      calls.push(`create:${input.name}:${input.baseRef}`);
      const path = worktreePath(input.name);
      await mkdir(path, { recursive: true });
      return { worktreePath: path, branch: `piwin/subagent/${input.name}` };
    },
    async removeWorktree(input) {
      calls.push(`remove:${input.worktreePath}`);
      if (this.removeFails) throw new Error('not a working tree');
      await rm(input.worktreePath, { recursive: true, force: true });
    },
    async writeWorktreeResultTree() {
      calls.push('freeze');
      // Read through the returned object: the pool spreads the port, so a
      // `this` binding would see a stale copy of `liveTree`.
      return { tree: fake.liveTree };
    },
    async commitResultSnapshot(input) {
      calls.push(`preserve:${input.resultId}`);
      return { tree: input.tree, commit: 'c0ffee', ref: `refs/piwin/results/${input.resultId}` };
    },
    async treeOfCommit() {
      return 'base-tree';
    },
    async resetWorktreeToBase(input) {
      calls.push(`reset:${input.baseCommit}`);
    },
    async isWorktreeUsable() {
      return this.usable;
    },
    worktreeRepositoryKey() {
      return 'repo-key';
    },
  };
  return fake;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('writer slot naming', () => {
  it('recognises the slot namespace and not task copies', () => {
    expect(isWriterSlotName('slot-0')).toBe(true);
    expect(isWriterSlotName('slot-12')).toBe(true);
    expect(isWriterSlotName('subagent-task-1-abc')).toBe(false);
    expect(isWriterSlotBranch('piwin/subagent/slot-0')).toBe(true);
    expect(isWriterSlotBranch('piwin/subagent/task-1')).toBe(false);
    expect(isWriterSlotWorktreePath('/home/u/.piwin/worktrees/key/slot-0')).toBe(true);
    expect(isWriterSlotWorktreePath('/home/u/.piwin/worktrees/key/subagent-1')).toBe(false);
  });
});

describe('writer slot pool', () => {
  it('creates the slot once then resets it in place', async () => {
    const storageRoot = await temporaryRoot();
    const git = createFakeGit(storageRoot);
    const pool = createWriterSlotPool({ git });

    const first = await pool.acquire({
      projectPath: '/repo',
      storageRoot,
      baseCommit: 'aaaa1111',
    });
    expect(first).toMatchObject({
      slotId: DEFAULT_WRITER_SLOT_ID,
      worktreeBranch: 'piwin/subagent/slot-0',
      baseCommit: 'aaaa1111',
      rebuilt: true,
    });
    await pool.release({ projectPath: '/repo', storageRoot, slotId: first.slotId });

    const second = await pool.acquire({
      projectPath: '/repo',
      storageRoot,
      baseCommit: 'bbbb2222',
    });
    expect(second.rebuilt).toBe(false);
    expect(second.worktreePath).toBe(first.worktreePath);
    expect(git.calls.filter((call) => call.startsWith('create:'))).toEqual([
      'create:slot-0:aaaa1111',
    ]);
    expect(git.calls).toContain('reset:bbbb2222');
  });

  it('rebuilds rather than reusing an unusable or dirty slot', async () => {
    const storageRoot = await temporaryRoot();
    const git = createFakeGit(storageRoot);
    const pool = createWriterSlotPool({ git });

    await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'aaaa1111' });
    await pool.release({ projectPath: '/repo', storageRoot, slotId: DEFAULT_WRITER_SLOT_ID, dirty: true });

    const record = await pool.read({ projectPath: '/repo', storageRoot });
    expect(record?.state).toBe('dirty');

    const rebuilt = await pool.acquire({
      projectPath: '/repo',
      storageRoot,
      baseCommit: 'cccc3333',
    });
    expect(rebuilt.rebuilt).toBe(true);
    expect(git.calls).toContain(`remove:${rebuilt.worktreePath}`);
    expect(git.calls.filter((call) => call.startsWith('create:'))).toHaveLength(2);
  });

  it('rebuilds when the checkout is gone even though the record says idle', async () => {
    const storageRoot = await temporaryRoot();
    const git = createFakeGit(storageRoot, false);
    const pool = createWriterSlotPool({ git });

    const acquired = await pool.acquire({
      projectPath: '/repo',
      storageRoot,
      baseCommit: 'aaaa1111',
    });
    expect(acquired.rebuilt).toBe(true);
  });

  it('carries the previous dependency fingerprint so an install can be reused', async () => {
    const storageRoot = await temporaryRoot();
    const pool = createWriterSlotPool({ git: createFakeGit(storageRoot) });

    await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'aaaa1111' });
    await pool.recordDependencyFingerprint({
      projectPath: '/repo',
      storageRoot,
      slotId: DEFAULT_WRITER_SLOT_ID,
      fingerprint: 'fp-1',
      baseCommit: 'aaaa1111',
    });
    await pool.release({ projectPath: '/repo', storageRoot, slotId: DEFAULT_WRITER_SLOT_ID });

    const next = await pool.acquire({
      projectPath: '/repo',
      storageRoot,
      baseCommit: 'bbbb2222',
    });
    expect(next.previousDependencyFingerprint).toBe('fp-1');

    // A cleared fingerprint must not resurrect an old install.
    await pool.recordDependencyFingerprint({
      projectPath: '/repo',
      storageRoot,
      slotId: DEFAULT_WRITER_SLOT_ID,
      fingerprint: undefined,
      baseCommit: 'bbbb2222',
    });
    const cleared = await pool.read({ projectPath: '/repo', storageRoot });
    expect(cleared?.dependencyFingerprint).toBeUndefined();
  });

  it('keeps slot metadata out of the worktree directory listing semantics', async () => {
    const storageRoot = await temporaryRoot();
    const pool = createWriterSlotPool({ git: createFakeGit(storageRoot) });
    await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'aaaa1111' });

    const recordPath = join(storageRoot, 'repo-key', 'slot-0.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as { state: string };
    expect(record.state).toBe('leased');

    // A half-written record must never be adopted as a ready slot.
    await writeFile(recordPath, '{ not json', 'utf8');
    const poolAfterCorrupt = createWriterSlotPool({ git: createFakeGit(storageRoot) });
    const acquired = await poolAfterCorrupt.acquire({
      projectPath: '/repo',
      storageRoot,
      baseCommit: 'dddd4444',
    });
    expect(acquired.rebuilt).toBe(true);
  });

  it('freezes a slot the Host left leased before resetting it', async () => {
    const storageRoot = await temporaryRoot();
    const git = createFakeGit(storageRoot);
    const warnings: string[] = [];
    const pool = createWriterSlotPool({ git, onWarning: (message) => warnings.push(message) });
    await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'aaaa1111' });
    // No release: the Host died mid-task. The slot holds unfrozen work.
    git.liveTree = 'child-work-tree';
    git.calls.length = 0;

    await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'bbbb2222' });
    expect(git.calls[0]).toBe('freeze');
    expect(git.calls[1]).toMatch(/^preserve:recovered-slot-0-/);
    expect(git.calls[2]).toBe('reset:bbbb2222');
    expect(warnings[0]).toContain('refs/piwin/results/recovered-slot-0-');
  });

  it('does not preserve a clean stale slot or touch a released one', async () => {
    const storageRoot = await temporaryRoot();
    const git = createFakeGit(storageRoot);
    const pool = createWriterSlotPool({ git, onWarning: () => undefined });
    await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'aaaa1111' });
    git.calls.length = 0;
    await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'bbbb2222' });
    expect(git.calls).toEqual(['freeze', 'reset:bbbb2222']);

    await pool.release({ projectPath: '/repo', storageRoot, slotId: DEFAULT_WRITER_SLOT_ID });
    git.calls.length = 0;
    await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'cccc3333' });
    expect(git.calls).toEqual(['reset:cccc3333']);
  });

  it('clears a slot directory git can no longer remove before rebuilding', async () => {
    const storageRoot = await temporaryRoot();
    const git = createFakeGit(storageRoot, false);
    git.removeFails = true;
    const slotPath = join(storageRoot, 'repo-key', 'slot-0');
    await mkdir(slotPath, { recursive: true });
    await writeFile(join(slotPath, 'leftover.txt'), 'x', 'utf8');
    const pool = createWriterSlotPool({ git, onWarning: () => undefined });

    const acquired = await pool.acquire({ projectPath: '/repo', storageRoot, baseCommit: 'aaaa1111' });
    expect(acquired.rebuilt).toBe(true);
    await expect(readFile(join(slotPath, 'leftover.txt'), 'utf8')).rejects.toThrow();
  });
});

import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTurnChangeObjectStore } from './object-store.js';
import { planUndoRedo, type PlannedFileOp } from './operation-plan.js';
import { runTurnChangeOperation } from './operation-runner.js';
import { precheckTurnChangeOperation } from './precheck.js';
import { openTurnChangeStore } from './store.js';

const temporaryDirectories: string[] = [];
const text = new TextEncoder();
/** One gesture per test run. */
const GESTURE = 'precheck-gesture';

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function initRepo(): Promise<string> {
  const root = await tempDir('piwin-precheck-repo-');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  return root;
}

/** A turn that changed `a.txt` (and `b.txt`) from "before" to "after". */
async function sealedTurn(workspaceRoot: string) {
  const storeRoot = await tempDir('piwin-precheck-store-');
  const objectStore = createTurnChangeObjectStore({ rootDir: storeRoot });
  const store = openTurnChangeStore({ rootDir: storeRoot });
  store.createAttempt({ changeSetId: 'cs-1', attemptId: 'att-1', sessionId: 's-1', workspaceId: 'ws-1' });
  const before = await objectStore.put(text.encode('before\n'));
  const after = await objectStore.put(text.encode('after\n'));
  await writeFile(join(workspaceRoot, 'a.txt'), 'after\n');
  await writeFile(join(workspaceRoot, 'b.txt'), 'after\n');
  const files: PlannedFileOp[] = planUndoRedo({
    direction: 'undo',
    files: ['a.txt', 'b.txt'].map((relativePath) => ({
      relativePath,
      beforeSha: before.sha256,
      afterSha: after.sha256,
      beforeExists: true,
      afterExists: true,
    })),
  });
  return { store, objectStore, storeRoot, files, before, after };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('precheckTurnChangeOperation', () => {
  it('allows an undo whose files still hold the turn result (non-Git directory)', async () => {
    const root = await tempDir('piwin-precheck-plain-');
    const { files, objectStore, store } = await sealedTurn(root);
    expect(await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore })).toEqual({ ok: true });
    store.close();
  });

  it('refuses staged-paths for a staged affected path and leaves index and HEAD alone', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'a.txt'), 'before\n');
    await writeFile(join(root, 'b.txt'), 'before\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'base');
    const head = git(root, 'rev-parse', 'HEAD');
    const { files, objectStore, store } = await sealedTurn(root);
    git(root, 'add', 'a.txt');
    const indexBefore = git(root, 'diff', '--cached', '--name-status');

    const result = await runTurnChangeOperation({
      workspaceRoot: root,
      store,
      objectStore,
      principal: 'host',
      idempotencyKey: GESTURE,
      requestHash: 'h',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      files,
    });

    expect(result).toMatchObject({ status: 'rejected', reason: 'staged-paths', affectedPaths: ['a.txt'] });
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('after\n');
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('after\n');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(root, 'diff', '--cached', '--name-status')).toBe(indexBefore);
    store.close();
  });

  it('refuses staged-paths for an unmerged (conflicted) path', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'a.txt'), 'base\n');
    await writeFile(join(root, 'b.txt'), 'base\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'base');
    git(root, 'checkout', '-qb', 'other');
    await writeFile(join(root, 'a.txt'), 'other\n');
    git(root, 'commit', '-qam', 'other');
    git(root, 'checkout', '-q', '-');
    await writeFile(join(root, 'a.txt'), 'mine\n');
    git(root, 'commit', '-qam', 'mine');
    try {
      git(root, 'merge', '-q', 'other');
    } catch {
      // Expected: the merge stops on the conflict.
    }
    const { files, objectStore, store } = await sealedTurn(root);
    const result = await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore });
    expect(result).toEqual({ ok: false, reason: 'staged-paths', affectedPaths: ['a.txt'] });
    store.close();
  });

  it('does not refuse when HEAD moved but the files still hold the turn result', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'a.txt'), 'before\n');
    await writeFile(join(root, 'b.txt'), 'before\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'base');
    const { files, objectStore, store } = await sealedTurn(root);
    git(root, 'commit', '-qam', 'commit the turn');
    expect(await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore })).toEqual({ ok: true });
    store.close();
  });

  it('refuses backup-failed with zero writes when undo data is gone from the store', async () => {
    const root = await tempDir('piwin-precheck-backup-');
    const { files, objectStore, store, storeRoot, before } = await sealedTurn(root);
    await unlink(join(storeRoot, 'objects', before.sha256.slice(0, 2), before.sha256.slice(2)));
    const result = await runTurnChangeOperation({
      workspaceRoot: root,
      store,
      objectStore,
      principal: 'host',
      idempotencyKey: GESTURE,
      requestHash: 'h',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      files,
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'backup-failed' });
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('after\n');
    store.close();
  });

  it.skipIf(process.getuid?.() === 0)('refuses permission-denied for an unreadable path', async () => {
    const root = await tempDir('piwin-precheck-perm-');
    const { files, objectStore, store } = await sealedTurn(root);
    await chmod(join(root, 'a.txt'), 0o000);
    try {
      const result = await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore });
      expect(result).toEqual({ ok: false, reason: 'permission-denied', affectedPaths: ['a.txt'] });
    } finally {
      await chmod(join(root, 'a.txt'), 0o644);
    }
    store.close();
  });

  it('reports files-changed before any other reason', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'a.txt'), 'before\n');
    await writeFile(join(root, 'b.txt'), 'before\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'base');
    const { files, objectStore, store } = await sealedTurn(root);
    git(root, 'add', 'a.txt');
    await writeFile(join(root, 'b.txt'), 'edited\n');
    const result = await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore });
    expect(result).toEqual({ ok: false, reason: 'files-changed', affectedPaths: ['b.txt'] });
    store.close();
  });

  describe('skippable files', () => {
    async function skippableTurn(root: string) {
      const turn = await sealedTurn(root);
      const made = await turn.objectStore.put(text.encode('generated\n'));
      await writeFile(join(root, 'made.log'), 'generated\n');
      const files: PlannedFileOp[] = [
        ...turn.files,
        {
          relativePath: 'made.log',
          fromSha: made.sha256,
          toSha: null,
          fromExists: true,
          toExists: false,
          skippable: true,
        },
      ];
      return { ...turn, files };
    }

    it('passes untouched, with nothing skipped', async () => {
      const root = await tempDir('piwin-precheck-skip-');
      const { files, objectStore, store } = await skippableTurn(root);
      expect(await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore })).toEqual({ ok: true });
      store.close();
    });

    it('reports a skippable file that changed and does not refuse for it', async () => {
      const root = await tempDir('piwin-precheck-skip-');
      const { files, objectStore, store } = await skippableTurn(root);
      await writeFile(join(root, 'made.log'), 'generated\nmore later\n');
      expect(await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore })).toEqual({
        ok: true,
        skipped: ['made.log'],
      });
      store.close();
    });

    it('drops a skippable file that is already gone without reporting it', async () => {
      const root = await tempDir('piwin-precheck-skip-');
      const { files, objectStore, store } = await skippableTurn(root);
      await unlink(join(root, 'made.log'));
      expect(await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore })).toEqual({
        ok: true,
        gone: ['made.log'],
      });
      store.close();
    });

    it('still refuses for a file that is not skippable, even beside a skipped one', async () => {
      const root = await tempDir('piwin-precheck-skip-');
      const { files, objectStore, store } = await skippableTurn(root);
      await writeFile(join(root, 'made.log'), 'changed\n');
      await writeFile(join(root, 'a.txt'), 'someone else\n');
      expect(await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore })).toEqual({
        ok: false,
        reason: 'files-changed',
        affectedPaths: ['a.txt'],
      });
      store.close();
    });

    it('does not let a skipped file be judged staged', async () => {
      const root = await initRepo();
      await writeFile(join(root, 'a.txt'), 'before\n');
      await writeFile(join(root, 'b.txt'), 'before\n');
      git(root, 'add', '.');
      git(root, 'commit', '-qm', 'base');
      const { files, objectStore, store } = await skippableTurn(root);
      await writeFile(join(root, 'made.log'), 'changed later\n');
      git(root, 'add', 'made.log');
      expect(await precheckTurnChangeOperation({ workspaceRoot: root, files, objectStore })).toEqual({
        ok: true,
        skipped: ['made.log'],
      });
      store.close();
    });
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runGitCommand } from '../git-command-runner.js';
import { freezeWorktreeAgainstBase } from './freeze-tree.js';
import { openTurnChangeStore } from './store.js';

const temporaryDirectories: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGitCommand({ cwd, args });
  return result.stdout.trim();
}

describe('freezeWorktreeAgainstBase', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('freezes S0 from the child base commit, not later HEAD, and keeps bytes after copy cleanup', async () => {
    const worktreePath = await createTempDir('piwin-freeze-tree-');
    const store = openTurnChangeStore({
      rootDir: await createTempDir('piwin-freeze-store-'),
    });

    await git(worktreePath, ['init']);
    await git(worktreePath, ['config', 'user.email', 't@example.com']);
    await git(worktreePath, ['config', 'user.name', 't']);
    await writeFile(join(worktreePath, 'hello.txt'), 'base\n', 'utf8');
    await git(worktreePath, ['add', 'hello.txt']);
    await git(worktreePath, ['commit', '-m', 'base']);
    const baseCommit = await git(worktreePath, ['rev-parse', 'HEAD']);

    await writeFile(join(worktreePath, 'hello.txt'), 'child\n', 'utf8');
    await writeFile(join(worktreePath, 'extra.txt'), 'extra\n', 'utf8');

    const frozen = await freezeWorktreeAgainstBase({ worktreePath, baseCommit, store });
    expect(frozen.coverage).toBe('complete');
    expect(frozen.baseCommit).toBe(baseCommit);
    expect(frozen.files.map((file) => file.relativePath).sort()).toEqual(['extra.txt', 'hello.txt']);

    const hello = frozen.files.find((file) => file.relativePath === 'hello.txt');
    const extra = frozen.files.find((file) => file.relativePath === 'extra.txt');
    expect(hello?.beforeExists).toBe(true);
    expect(hello?.afterExists).toBe(true);
    expect(extra?.beforeExists).toBe(false);
    expect(extra?.afterExists).toBe(true);
    if (!hello?.beforeSha || !hello.afterSha || !extra?.afterSha) {
      throw new Error('expected object hashes');
    }
    expect(Buffer.from(await store.getObject(hello.beforeSha)).toString('utf8')).toBe('base\n');
    expect(Buffer.from(await store.getObject(hello.afterSha)).toString('utf8')).toBe('child\n');
    expect(Buffer.from(await store.getObject(extra.afterSha)).toString('utf8')).toBe('extra\n');

    store.createAttempt({
      changeSetId: 'child-result-1',
      attemptId: 'attempt-1',
      sessionId: 'child-1',
      workspaceId: 'ws-1',
    });
    const published = store.publishChangeVersion({
      changeSetId: 'child-result-1',
      revision: 1,
      files: frozen.files,
      coverageComplete: frozen.coverage === 'complete',
    });
    expect(published.fileCount).toBe(2);

    await git(worktreePath, ['add', 'hello.txt', 'extra.txt']);
    await git(worktreePath, ['commit', '-m', 'advance HEAD']);
    const head = await git(worktreePath, ['rev-parse', 'HEAD']);
    expect(head).not.toBe(baseCommit);

    const again = await freezeWorktreeAgainstBase({ worktreePath, baseCommit, store });
    const helloAgain = again.files.find((file) => file.relativePath === 'hello.txt');
    if (!helloAgain?.beforeSha) {
      throw new Error('expected baseline hash after HEAD moved');
    }
    expect(Buffer.from(await store.getObject(helloAgain.beforeSha)).toString('utf8')).toBe(
      'base\n',
    );

    await rm(join(worktreePath, 'hello.txt'));
    await rm(join(worktreePath, 'extra.txt'));
    expect(Buffer.from(await store.getObject(extra.afterSha)).toString('utf8')).toBe('extra\n');
    expect(Buffer.from(await store.getObject(hello.afterSha)).toString('utf8')).toBe('child\n');
    const reloaded = store.getChangeVersion('child-result-1', 1);
    expect(reloaded?.files.map((file) => file.relativePath).sort()).toEqual([
      'extra.txt',
      'hello.txt',
    ]);
    store.close();
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openTurnChangeStore, runGitCommand } from '@piwin/git';
import { freezeSubagentChildResult } from './subagent-result-freeze.js';

const dirs: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  return (await runGitCommand({ cwd, args })).stdout.trim();
}

describe('freezeSubagentChildResult', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('keeps S1 bytes after the child copy is deleted and does not use parent HEAD as S0', async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), 'piwin-freeze-child-'));
    const storeRoot = await mkdtemp(join(tmpdir(), 'piwin-freeze-child-store-'));
    dirs.push(worktreePath, storeRoot);
    const store = openTurnChangeStore({ rootDir: storeRoot });

    await git(worktreePath, ['init']);
    await git(worktreePath, ['config', 'user.email', 't@example.com']);
    await git(worktreePath, ['config', 'user.name', 't']);
    await writeFile(join(worktreePath, 'a.txt'), 's0\n');
    await git(worktreePath, ['add', 'a.txt']);
    await git(worktreePath, ['commit', '-m', 's0']);
    const baseCommit = await git(worktreePath, ['rev-parse', 'HEAD']);
    await writeFile(join(worktreePath, 'a.txt'), 's1\n');

    const frozen = await freezeSubagentChildResult({
      store,
      result: {
        runId: 'run-1',
        taskId: 'task-1',
        childSessionId: 'child-1',
        executionStatus: 'completed',
        summaryStatus: 'merged',
        integrationStatus: 'pending',
        worktreePath,
      },
      lease: {
        mode: 'worktree',
        cwd: worktreePath,
        parentRepoPath: worktreePath,
        worktreePath,
        worktreeBranch: 'child',
        baseCommit,
      },
    });
    expect(frozen.resultRef?.revision).toBe(1);
    expect(frozen.childChanges?.revision).toBe(1);
    const version = store.getChangeVersion(frozen.childChanges?.changeSetId ?? '', 1);
    const file = version?.files[0];
    if (!file?.beforeSha || !file.afterSha) throw new Error('expected hashes');
    expect(Buffer.from(await store.getObject(file.beforeSha)).toString('utf8')).toBe('s0\n');
    expect(Buffer.from(await store.getObject(file.afterSha)).toString('utf8')).toBe('s1\n');

    await rm(join(worktreePath, 'a.txt'));
    expect(Buffer.from(await store.getObject(file.afterSha)).toString('utf8')).toBe('s1\n');
    store.close();
  });
});

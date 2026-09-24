import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runGitCommand } from '../git-command-runner.js';
import { createWorktree, removeWorktree } from '../worktree.js';
import {
  checkoutWorktreeTree,
  commitResultSnapshot,
  resultSnapshotRefName,
  writeWorktreeResultTree,
} from './git-snapshot.js';
import { integrateSnapshotChanges, integrateWorktreeChanges } from '../worktree-integration.js';

const roots: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGitCommand({ cwd, args });
  return result.stdout.trim();
}

async function createRepository(
  name: string,
): Promise<{ projectPath: string; storageRoot: string }> {
  const projectPath = await mkdtemp(join(tmpdir(), `piwin-snapshot-${name}-`));
  const storageRoot = await mkdtemp(join(tmpdir(), `piwin-snapshot-${name}-wt-`));
  roots.push(projectPath, storageRoot);
  await git(projectPath, ['init', '-b', 'main']);
  await git(projectPath, ['config', 'user.email', 'piwin-test@example.com']);
  await git(projectPath, ['config', 'user.name', 'piwin test']);
  await writeFile(join(projectPath, 'a.txt'), 'base-a\n');
  await writeFile(join(projectPath, 'old.txt'), 'remove me\n');
  await writeFile(join(projectPath, 'script.sh'), '#!/bin/sh\necho base\n');
  await git(projectPath, ['add', '--all']);
  await git(projectPath, ['commit', '-m', 'base']);
  return { projectPath, storageRoot };
}

/** Tree of a working directory, computed through a throwaway index. */
async function workingTreeOf(workspaceRoot: string): Promise<string> {
  const indexDirectory = await mkdtemp(join(tmpdir(), 'piwin-snapshot-probe-'));
  roots.push(indexDirectory);
  const env = { GIT_INDEX_FILE: join(indexDirectory, 'index') };
  await runGitCommand({ cwd: workspaceRoot, args: ['add', '--all', '--', '.'], env });
  const written = await runGitCommand({ cwd: workspaceRoot, args: ['write-tree'], env });
  return written.stdout.trim();
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('git result snapshot', () => {
  it('records symlinks, exec bits and deletions in a git-native tree', async () => {
    const { projectPath, storageRoot } = await createRepository('fidelity');
    const baseCommit = await git(projectPath, ['rev-parse', 'HEAD']);
    const worktree = await createWorktree({
      projectPath,
      name: 'fidelity',
      baseRef: baseCommit,
      storageRoot,
    });

    await writeFile(join(worktree.worktreePath, 'a.txt'), 'child-a\n');
    await rm(join(worktree.worktreePath, 'old.txt'));
    await mkdir(join(worktree.worktreePath, 'bin'), { recursive: true });
    const executable = join(worktree.worktreePath, 'bin', 'run.sh');
    await writeFile(executable, '#!/bin/sh\necho child\n');
    await chmod(executable, 0o755);
    await symlink('a.txt', join(worktree.worktreePath, 'link.txt'));

    const { tree } = await writeWorktreeResultTree({
      worktreePath: worktree.worktreePath,
      baseCommit,
    });

    // The claim the CAS cannot make: the tree models non-regular entries exactly.
    const listing = await git(projectPath, ['ls-tree', '-r', tree]);
    expect(listing).toContain('100755 blob');
    expect(listing).toContain('bin/run.sh');
    expect(listing).toContain('120000 blob');
    expect(listing).toContain('link.txt');
    expect(listing).not.toContain('old.txt');

    const snapshot = await commitResultSnapshot({
      repoPath: projectPath,
      tree,
      baseCommit,
      resultId: 'result-fidelity',
    });
    expect(snapshot.ref).toBe(resultSnapshotRefName('result-fidelity'));
    expect(await git(projectPath, ['rev-parse', `${snapshot.ref}^{tree}`])).toBe(tree);
    // Reachability is the reason the ref exists: an amend or rebase of the
    // parent branch must not orphan the base this result was frozen against.
    expect(await git(projectPath, ['rev-parse', `${snapshot.ref}^`])).toBe(baseCommit);

    // Release the copy entirely; integration must still work.
    await removeWorktree({
      projectPath,
      worktreePath: worktree.worktreePath,
      worktreeBranch: worktree.branch,
      force: true,
    });

    const result = await integrateSnapshotChanges({
      projectPath,
      baseCommit,
      childTree: snapshot.tree,
    });
    expect(result.status).toBe('applied');
    expect(result.integratedFiles.sort()).toEqual(['a.txt', 'bin/run.sh', 'link.txt', 'old.txt']);

    await expect(readFile(join(projectPath, 'a.txt'), 'utf8')).resolves.toBe('child-a\n');
    await expect(readFile(join(projectPath, 'old.txt'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(projectPath, 'bin', 'run.sh'), 'utf8')).resolves.toBe(
      '#!/bin/sh\necho child\n',
    );
  });

  it('restores a frozen tree exactly when it is checked back out', async () => {
    const { projectPath, storageRoot } = await createRepository('restore');
    const baseCommit = await git(projectPath, ['rev-parse', 'HEAD']);
    const worktree = await createWorktree({
      projectPath,
      name: 'restore',
      baseRef: baseCommit,
      storageRoot,
    });
    await writeFile(join(worktree.worktreePath, 'a.txt'), 'child-a\n');
    await mkdir(join(worktree.worktreePath, 'bin'), { recursive: true });
    await writeFile(join(worktree.worktreePath, 'bin', 'run.sh'), '#!/bin/sh\necho child\n');
    await chmod(join(worktree.worktreePath, 'bin', 'run.sh'), 0o755);
    await symlink('a.txt', join(worktree.worktreePath, 'link.txt'));
    const { tree } = await writeWorktreeResultTree({
      worktreePath: worktree.worktreePath,
      baseCommit,
    });

    // Simulate the next task taking the slot: back to base, leftovers gone.
    await writeFile(join(worktree.worktreePath, 'scratch.txt'), 'next task residue\n');
    await git(worktree.worktreePath, ['reset', '--hard', baseCommit]);
    await git(worktree.worktreePath, ['clean', '-ffdx']);
    await expect(readFile(join(worktree.worktreePath, 'a.txt'), 'utf8')).resolves.toBe('base-a\n');
    await expect(readFile(join(worktree.worktreePath, 'scratch.txt'), 'utf8')).rejects.toThrow();

    await checkoutWorktreeTree({ worktreePath: worktree.worktreePath, tree });

    await expect(readFile(join(worktree.worktreePath, 'a.txt'), 'utf8')).resolves.toBe('child-a\n');
    await expect(readFile(join(worktree.worktreePath, 'scratch.txt'), 'utf8')).rejects.toThrow();
    expect(await workingTreeOf(worktree.worktreePath)).toBe(tree);
    expect((await lstat(join(worktree.worktreePath, 'bin', 'run.sh'))).mode & 0o777).toBe(0o755);
    expect((await lstat(join(worktree.worktreePath, 'link.txt'))).isSymbolicLink()).toBe(true);
  });

  it('a frozen tree and the live copy produce the same parent result', async () => {
    const { projectPath, storageRoot } = await createRepository('parity');
    const baseCommit = await git(projectPath, ['rev-parse', 'HEAD']);
    const worktree = await createWorktree({
      projectPath,
      name: 'parity',
      baseRef: baseCommit,
      storageRoot,
    });
    await writeFile(join(worktree.worktreePath, 'a.txt'), 'child-a\n');
    await rm(join(worktree.worktreePath, 'old.txt'));
    await writeFile(join(worktree.worktreePath, 'new.txt'), 'child-new\n');

    const { tree } = await writeWorktreeResultTree({
      worktreePath: worktree.worktreePath,
      baseCommit,
    });

    const fromCopy = await integrateWorktreeChanges({
      projectPath,
      worktreePath: worktree.worktreePath,
      worktreeBranch: worktree.branch,
      baseCommit,
    });
    expect(fromCopy.status).toBe('applied');
    const copyTree = await workingTreeOf(projectPath);

    await git(projectPath, ['reset', '--hard', baseCommit]);
    await git(projectPath, ['clean', '-ffdx']);

    const fromTree = await integrateSnapshotChanges({ projectPath, baseCommit, childTree: tree });
    expect(fromTree.status).toBe('applied');
    const snapshotTree = await workingTreeOf(projectPath);

    expect(snapshotTree).toBe(copyTree);
    expect(fromTree.integratedFiles.sort()).toEqual(fromCopy.integratedFiles.sort());
  });

  it('rejects an unsafe base commit before reading anything', async () => {
    const { projectPath } = await createRepository('unsafe');
    await expect(
      integrateSnapshotChanges({
        projectPath,
        baseCommit: '--output=/tmp/unsafe',
        childTree: 'abc123',
      }),
    ).rejects.toThrow('ref has invalid characters');
  });
});

/**
 * Real git, real workspace service, no mocks: the detached tester's worktree
 * must contain the parent's uncommitted work and must not block the writer.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { removeWorktree } from '@piwin/git';
import { createSubagentWorkspaceService } from './subagent-workspace-service.js';

const run = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

async function dirtyRepository(): Promise<{ project: string; storage: string }> {
  const project = await mkdtemp(join(tmpdir(), 'piwin-snap-int-project-'));
  const storage = await mkdtemp(join(tmpdir(), 'piwin-snap-int-wt-'));
  roots.push(project, storage);
  await git(project, 'init', '-b', 'main');
  await git(project, 'config', 'user.email', 'piwin-test@example.com');
  await git(project, 'config', 'user.name', 'piwin test');
  await writeFile(join(project, 'app.ts'), 'export const v = 1;\n');
  await writeFile(join(project, '.gitignore'), 'node_modules/\n');
  await git(project, 'add', '--all');
  await git(project, 'commit', '-m', 'base');
  // The state a user is in mid-task: edited tracked file, brand-new file,
  // and an ignored dependency directory that must never be copied.
  await writeFile(join(project, 'app.ts'), 'export const v = 2; // unsaved-by-git\n');
  await writeFile(join(project, 'new-feature.ts'), 'export const f = true;\n');
  await run('mkdir', ['-p', join(project, 'node_modules', 'dep')]);
  await writeFile(join(project, 'node_modules', 'dep', 'index.js'), 'ignored\n');
  return { project, storage };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('detached tester workspace (real git)', () => {
  it('gives the tester the parent workspace as it is now, and leaves the parent untouched', async () => {
    const { project, storage } = await dirtyRepository();
    const statusBefore = await git(project, 'status', '--porcelain');
    const headBefore = await git(project, 'rev-parse', 'HEAD');
    const service = createSubagentWorkspaceService({
      projectPath: project,
      worktreeStorageRoot: storage,
      // 'ask' with no consent flow would reject a normal write task on this dirty parent.
      dirtyBasePolicy: 'ask',
      parallelWritePolicy: 'worktree-only',
    });

    const lease = await service.acquire({
      id: 'tester-task',
      parentSessionId: 'parent',
      task: 'verify',
      isolationOverride: 'worktree',
      workspaceSnapshot: true,
    });
    if (lease.mode !== 'worktree') throw new Error('expected a worktree lease');

    expect(await readFile(join(lease.worktreePath, 'app.ts'), 'utf8')).toBe(
      'export const v = 2; // unsaved-by-git\n',
    );
    expect(await readFile(join(lease.worktreePath, 'new-feature.ts'), 'utf8')).toBe(
      'export const f = true;\n',
    );
    // Ignored content is not part of the snapshot.
    await expect(readFile(join(lease.worktreePath, 'node_modules', 'dep', 'index.js'))).rejects.toThrow();

    // The parent is exactly as the user left it, and no snapshot ref lingers.
    expect(await git(project, 'status', '--porcelain')).toBe(statusBefore);
    expect(await git(project, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(await git(project, 'for-each-ref', 'refs/piwin/results/')).toBe('');
    // The tester branch is based on a snapshot commit that sits on top of HEAD.
    expect(await git(lease.worktreePath, 'rev-parse', 'HEAD^')).toBe(headBefore);

    // Edits inside the tester copy never reach the user's checkout.
    await writeFile(join(lease.worktreePath, 'app.ts'), 'tester scribble\n');
    expect(await readFile(join(project, 'app.ts'), 'utf8')).toBe('export const v = 2; // unsaved-by-git\n');

    await removeWorktree({
      projectPath: project,
      worktreePath: lease.worktreePath,
      worktreeBranch: lease.worktreeBranch,
      force: true,
    });
    await service.release(lease);
  });

  it('does not hold up the single writer while a tester copy is alive', async () => {
    const { project, storage } = await dirtyRepository();
    // Normal writers need a clean parent; commit the work so only the lock is under test.
    await git(project, 'add', '--all');
    await git(project, 'commit', '-m', 'wip');
    const service = createSubagentWorkspaceService({
      projectPath: project,
      worktreeStorageRoot: storage,
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });

    const tester = await service.acquire({
      id: 'tester-task',
      parentSessionId: 'parent',
      task: 'verify',
      isolationOverride: 'worktree',
      workspaceSnapshot: true,
    });
    // If the snapshot path took the project write lock this would never resolve.
    const writer = await Promise.race([
      service.acquire({
        id: 'writer-task',
        parentSessionId: 'parent',
        task: 'implement',
        isolationOverride: 'worktree',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('writer blocked behind the tester')), 5_000),
      ),
    ]);
    expect(writer.mode).toBe('worktree');
    expect(writer.cwd).not.toBe(tester.cwd);

    for (const lease of [writer, tester]) {
      if (lease.mode !== 'worktree') continue;
      await service.release(lease);
      await removeWorktree({
        projectPath: project,
        worktreePath: lease.worktreePath,
        worktreeBranch: lease.worktreeBranch,
        force: true,
      });
    }
  });
});

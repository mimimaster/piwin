import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluateBashPermission } from './permission-policy.js';
import { isWorktreeConfinedRecursiveRemove } from './subagent-worktree-rm-approval.js';

describe('isWorktreeConfinedRecursiveRemove', () => {
  let base: string;
  let worktree: string;
  let mainCheckout: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'piwin-rm-approval-'));
    worktree = join(base, 'worktree');
    mainCheckout = join(base, 'main');
    await mkdir(join(worktree, 'packages', 'host-client', 'node_modules'), { recursive: true });
    await mkdir(join(mainCheckout, 'node_modules', 'pkg'), { recursive: true });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const check = (command: string) =>
    isWorktreeConfinedRecursiveRemove({
      command,
      worktreePath: worktree,
      evaluateStep: (step) => evaluateBashPermission(step, 'auto').decision,
    });

  it('approves the dependency reset a stuck child actually ran', async () => {
    await symlink(join(mainCheckout, 'node_modules'), join(worktree, 'node_modules'));
    const command = [
      'export PATH="/opt/homebrew/bin:$PATH"',
      "# do not mutate the main checkout's node_modules",
      'rm -f node_modules',
      'rm -rf packages/host-client/node_modules',
      'pnpm install --frozen-lockfile',
    ].join('\n');

    await expect(check(command)).resolves.toBe(true);
  });

  it('approves removing a symlink itself but not deleting through it', async () => {
    await symlink(join(mainCheckout, 'node_modules'), join(worktree, 'node_modules'));

    await expect(check('rm -rf node_modules')).resolves.toBe(true);
    await expect(check('rm -rf node_modules/')).resolves.toBe(false);
    await expect(check('rm -rf node_modules/pkg')).resolves.toBe(false);
  });

  it('asks for paths that leave the worktree or cannot be resolved up front', async () => {
    for (const command of [
      'rm -rf ../main/node_modules',
      `rm -rf ${join(mainCheckout, 'node_modules')}`,
      'rm -rf ~/cache',
      'rm -rf $DIR',
      'rm -rf dist/*',
      'rm -rf .',
      'rm -rf .git',
      'cd .. && rm -rf main',
      'ln -s ../main x && rm -rf x/pkg',
      'find . -name dist -exec rm -rf {} +',
      'rm -rf "dist"',
    ]) {
      await expect(check(command), command).resolves.toBe(false);
    }
  });

  it('keeps any other prompt reason in the same command', async () => {
    await expect(check('rm -rf dist && sudo make install')).resolves.toBe(false);
    await expect(check('rm -rf dist\ngit push --force')).resolves.toBe(false);
  });

  it('approves nested targets and ones that do not exist yet', async () => {
    await expect(check('rm -rf dist coverage packages/host-client/.vite')).resolves.toBe(true);
  });
});

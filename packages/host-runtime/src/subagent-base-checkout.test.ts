import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runGitCommand } from '@piwin/git';
import {
  SubagentBaseCheckoutError,
  resolveSubagentBaseCheckout,
  resolveSubagentBaseCommit,
} from './subagent-base-checkout.js';

const temporaryRoots: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  return (await runGitCommand({ cwd, args })).stdout.trim();
}

async function commitFile(cwd: string, name: string, content: string): Promise<string> {
  await writeFile(join(cwd, name), content);
  await git(cwd, ['add', '--all']);
  await git(cwd, ['commit', '-m', `add ${name}`]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

/** A project root on `main` plus a linked feature worktree one commit ahead. */
async function createProject(): Promise<{
  project: string;
  feature: string;
  featureHead: string;
  mainHead: string;
}> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'piwin-base-checkout-')));
  temporaryRoots.push(base);
  const project = join(base, 'project');
  await mkdir(project);
  await git(project, ['init', '-b', 'main']);
  await git(project, ['config', 'user.email', 'piwin-test@example.com']);
  await git(project, ['config', 'user.name', 'piwin test']);
  const mainHead = await commitFile(project, 'README.md', 'base\n');
  const feature = join(project, '.worktrees', 'feature');
  await git(project, ['worktree', 'add', '-b', 'feat/x', feature]);
  const featureHead = await commitFile(feature, 'feature.txt', 'feature\n');
  return { project, feature, featureHead, mainHead };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('resolveSubagentBaseCheckout', () => {
  it('resolves a branch to the worktree that has it checked out', async () => {
    const { project, feature, featureHead } = await createProject();

    const checkout = await resolveSubagentBaseCheckout({ projectPath: project, baseBranch: 'feat/x' });

    expect(checkout).toEqual({ targetPath: feature, branch: 'feat/x', baseCommit: featureHead });
  });

  it('accepts a fully qualified branch ref', async () => {
    const { project, feature } = await createProject();

    const checkout = await resolveSubagentBaseCheckout({
      projectPath: project,
      baseBranch: 'refs/heads/feat/x',
    });

    expect(checkout?.targetPath).toBe(feature);
  });

  it('keeps the project root when the requested branch is the root branch', async () => {
    const { project } = await createProject();

    await expect(
      resolveSubagentBaseCheckout({ projectPath: project, baseBranch: 'main' }),
    ).resolves.toBeUndefined();
  });

  it('refuses a branch that no worktree has checked out instead of falling back to the root', async () => {
    const { project } = await createProject();
    await git(project, ['branch', 'feat/parked']);

    await expect(
      resolveSubagentBaseCheckout({ projectPath: project, baseBranch: 'feat/parked' }),
    ).rejects.toBeInstanceOf(SubagentBaseCheckoutError);
    await expect(
      resolveSubagentBaseCheckout({ projectPath: project, baseBranch: 'does/not/exist' }),
    ).rejects.toThrow(/not checked out in any worktree/);
  });

  it('never offers a product-owned subagent copy as the lead checkout', async () => {
    const { project } = await createProject();
    const slot = join(project, '.worktrees', 'slot-0');
    await git(project, ['worktree', 'add', '-b', 'piwin/subagent/slot-0', slot]);

    await expect(
      resolveSubagentBaseCheckout({ projectPath: project, baseBranch: 'piwin/subagent/slot-0' }),
    ).rejects.toBeInstanceOf(SubagentBaseCheckoutError);
    await expect(
      resolveSubagentBaseCheckout({ projectPath: project, workingDirectory: slot }),
    ).resolves.toBeUndefined();
  });

  it('follows the session working directory into a linked worktree, including a subfolder', async () => {
    const { project, feature, featureHead } = await createProject();
    await mkdir(join(feature, 'src'));

    const checkout = await resolveSubagentBaseCheckout({
      projectPath: project,
      workingDirectory: join(feature, 'src'),
    });

    expect(checkout).toEqual({ targetPath: feature, branch: 'feat/x', baseCommit: featureHead });
  });

  it('keeps the project root for an ordinary working directory', async () => {
    const { project } = await createProject();
    await mkdir(join(project, 'packages'));

    await expect(
      resolveSubagentBaseCheckout({ projectPath: project, workingDirectory: join(project, 'packages') }),
    ).resolves.toBeUndefined();
    await expect(resolveSubagentBaseCheckout({ projectPath: project })).resolves.toBeUndefined();
  });

  it('lets an explicit branch win over the working directory', async () => {
    const { project, feature } = await createProject();
    const other = join(project, '.worktrees', 'other');
    await git(project, ['worktree', 'add', '-b', 'feat/other', other]);

    const checkout = await resolveSubagentBaseCheckout({
      projectPath: project,
      baseBranch: 'feat/x',
      workingDirectory: other,
    });

    expect(checkout?.targetPath).toBe(feature);
  });
});

describe('resolveSubagentBaseCommit', () => {
  it('returns the lead checkout tip, else the project root tip', async () => {
    const { project, featureHead, mainHead } = await createProject();

    await expect(
      resolveSubagentBaseCommit({ projectPath: project, baseBranch: 'feat/x' }),
    ).resolves.toBe(featureHead);
    await expect(resolveSubagentBaseCommit({ projectPath: project })).resolves.toBe(mainHead);
  });
});

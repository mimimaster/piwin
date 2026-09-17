/**
 * Install dependencies into a freshly created subagent worktree.
 *
 * `git worktree add` checks out tracked files only. Without this step children
 * either cannot run tests or improvise, e.g. by symlinking node_modules to the
 * main checkout, which makes workspace packages resolve to the main checkout's
 * sources so the child verifies code it did not change.
 *
 * The Host installs only when the parent checkout has installed dependencies
 * itself, and uses the lockfile's package manager with frozen, offline-first
 * flags so the child gets the parent's exact dependency graph quickly.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SubagentWorktreeDependencySetup } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

export const WORKTREE_DEPENDENCY_INSTALL_TIMEOUT_MS = 5 * 60_000;
const FAILURE_DETAIL_MAX_CHARS = 600;

type PackageManager = NonNullable<SubagentWorktreeDependencySetup['manager']>;

export type WorktreeDependencyInstallPlan = {
  manager: PackageManager;
  command: string;
  args: string[];
};

export type WorktreeDependencyCommandRunner = (input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<void>;

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Choose the install command from the worktree's lockfile, or none. */
export async function detectWorktreeDependencyInstall(
  worktreePath: string,
): Promise<WorktreeDependencyInstallPlan | undefined> {
  const has = (name: string): Promise<boolean> => isFile(join(worktreePath, name));
  if (await has('pnpm-lock.yaml')) {
    return {
      manager: 'pnpm',
      command: 'pnpm',
      args: ['install', '--frozen-lockfile', '--prefer-offline', '--config.confirmModulesPurge=false'],
    };
  }
  if ((await has('bun.lock')) || (await has('bun.lockb'))) {
    return { manager: 'bun', command: 'bun', args: ['install', '--frozen-lockfile'] };
  }
  if (await has('yarn.lock')) {
    // Yarn Berry projects carry .yarnrc.yml and renamed the frozen flag.
    return (await has('.yarnrc.yml'))
      ? { manager: 'yarn', command: 'yarn', args: ['install', '--immutable'] }
      : {
          manager: 'yarn',
          command: 'yarn',
          args: ['install', '--frozen-lockfile', '--prefer-offline'],
        };
  }
  if (await has('package-lock.json')) {
    return {
      manager: 'npm',
      command: 'npm',
      args: ['ci', '--prefer-offline', '--no-audit', '--no-fund'],
    };
  }
  return undefined;
}

const runWithExecFile: WorktreeDependencyCommandRunner = (input) =>
  new Promise((resolve, reject) => {
    execFile(
      input.command,
      input.args,
      {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, CI: '1' },
        ...(input.signal ? { signal: input.signal } : {}),
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const detail = String(stderr ?? '').trim();
        reject(new Error(detail ? `${error.message}\n${detail}` : error.message));
      },
    );
  });

function boundedDetail(error: unknown): string {
  const message = formatError(error).trim();
  return message.length > FAILURE_DETAIL_MAX_CHARS
    ? `…${message.slice(-FAILURE_DETAIL_MAX_CHARS)}`
    : message;
}

/**
 * Install the worktree's dependencies. Never throws: a failed install is
 * recorded on the lease and told to the child instead of failing the task.
 */
export async function prepareWorktreeDependencies(input: {
  worktreePath: string;
  parentRepoPath: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  runCommand?: WorktreeDependencyCommandRunner;
}): Promise<SubagentWorktreeDependencySetup> {
  if (!(await isDirectory(join(input.parentRepoPath, 'node_modules')))) {
    return { status: 'skipped', reason: 'parent checkout has no installed dependencies' };
  }
  const plan = await detectWorktreeDependencyInstall(input.worktreePath);
  if (!plan) {
    return { status: 'skipped', reason: 'no supported lockfile' };
  }
  const startedAt = Date.now();
  try {
    if (input.signal?.aborted) {
      throw new Error('cancelled before dependency install');
    }
    await (input.runCommand ?? runWithExecFile)({
      command: plan.command,
      args: plan.args,
      cwd: input.worktreePath,
      timeoutMs: input.timeoutMs ?? WORKTREE_DEPENDENCY_INSTALL_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return { status: 'installed', manager: plan.manager, durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: 'failed',
      manager: plan.manager,
      reason: boundedDetail(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Seed-prompt guidance matching what the Host did to the worktree. */
export function formatWorktreeDependencyGuidance(
  setup: SubagentWorktreeDependencySetup | undefined,
): string {
  const noSymlink =
    'Never symlink node_modules or other build state to another checkout: packages would ' +
    'resolve to that checkout and your checks would not cover your own changes.';
  if (setup?.status === 'installed') {
    return `Dependencies were installed in this worktree by the Host (${setup.manager}). ${noSymlink}`;
  }
  if (setup?.status === 'failed') {
    const manager = setup.manager ?? 'the package manager';
    return (
      `The Host could not install dependencies in this worktree (${manager}: ` +
      `${(setup.reason ?? 'unknown error').split('\n')[0]}). If you need to run code, install ` +
      `them inside this worktree with ${manager}. ${noSymlink}`
    );
  }
  return noSymlink;
}

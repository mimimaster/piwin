/**
 * Install dependencies into a subagent workspace copy.
 *
 * `git worktree add` checks out tracked files only. Without this step children
 * either cannot run tests or improvise, e.g. by symlinking node_modules to the
 * main checkout, which makes workspace packages resolve to the main checkout's
 * sources so the child verifies code it did not change. That improvisation is
 * detectable (`findDependenciesOutsideWorktree`) and is reported to the parent
 * rather than silently believed.
 *
 * The Host installs only when the parent checkout has installed dependencies
 * itself, and reuses an existing install when the dependency inputs are
 * unchanged. A reused install is what makes the shared writer slot cheap:
 * resetting a worktree moves tracked files, and reinstalling for an identical
 * lockfile would throw that away on every task.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, readlink, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { SubagentWorktreeDependencySetup } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

import { ensureLoginShellPath } from './login-shell-path.js';

export const WORKTREE_DEPENDENCY_INSTALL_TIMEOUT_MS = 5 * 60_000;
const FAILURE_DETAIL_MAX_CHARS = 600;
/** Bounds the symlink audit so a huge dependency tree cannot stall a freeze. */
const MAX_DEPENDENCY_SCAN_ENTRIES = 5_000;
const NODE_MODULES_DIRECTORY = 'node_modules';

/** Files whose contents change the resolved dependency graph. */
const FINGERPRINT_FILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pnpm-workspace.yaml',
  'pnpm-workspace.yml',
  '.npmrc',
  '.yarnrc.yml',
  'lerna.json',
] as const;

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

async function hashIfPresent(hash: ReturnType<typeof createHash>, worktreePath: string, name: string): Promise<void> {
  try {
    const bytes = await readFile(join(worktreePath, name));
    hash.update(`\u0000${name}\u0000`);
    hash.update(bytes);
  } catch {
    // Absent inputs contribute nothing; presence changes the digest.
  }
}

async function hashPatchDirectory(
  hash: ReturnType<typeof createHash>,
  worktreePath: string,
): Promise<void> {
  const patchesDirectory = join(worktreePath, 'patches');
  let entries: string[];
  try {
    entries = await readdir(patchesDirectory);
  } catch {
    return;
  }
  for (const entry of [...entries].sort()) {
    await hashIfPresent(hash, patchesDirectory, entry);
  }
}

/**
 * Hash of everything that decides the installed dependency graph.
 *
 * Returns `undefined` when the workspace has no lockfile: with nothing to
 * compare there is no safe reuse, so callers must install.
 */
export async function computeWorktreeDependencyFingerprint(
  worktreePath: string,
): Promise<string | undefined> {
  const plan = await detectWorktreeDependencyInstall(worktreePath);
  if (!plan) return undefined;
  const hash = createHash('sha256');
  hash.update(`manager\u0000${plan.manager}\u0000`);
  for (const name of FINGERPRINT_FILES) {
    await hashIfPresent(hash, worktreePath, name);
  }
  await hashPatchDirectory(hash, worktreePath);
  try {
    const manifest = JSON.parse(await readFile(join(worktreePath, 'package.json'), 'utf8')) as {
      packageManager?: unknown;
    };
    if (typeof manifest.packageManager === 'string') {
      hash.update(`packageManager\u0000${manifest.packageManager}\u0000`);
    }
  } catch {
    // A missing or unparseable manifest simply does not contribute.
  }
  return hash.digest('hex');
}

/**
 * Dependency links that resolve outside the workspace.
 *
 * A child that symlinks the main checkout's `node_modules` makes every
 * workspace package resolve to code it did not change, so a green test run
 * proves nothing about the child's diff. The Host cannot forbid the link after
 * the fact, but it can refuse to treat the run as verified.
 */
export async function findDependenciesOutsideWorktree(
  worktreePath: string,
): Promise<string[]> {
  const root = resolve(await realpath(worktreePath).catch(() => resolve(worktreePath)));
  const found: string[] = [];
  let scanned = 0;
  for (const directory of await dependencyDirectories(resolve(worktreePath))) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (scanned >= MAX_DEPENDENCY_SCAN_ENTRIES) return found;
      scanned += 1;
      if (!entry.isSymbolicLink() && !entry.isDirectory()) continue;
      const absolute = join(directory, entry.name);
      const linkTarget = await readlink(absolute).catch(() => undefined);
      if (linkTarget === undefined) {
        // Scoped packages (@scope/name) nest one level; follow it by hand.
        if (!entry.name.startsWith('@')) continue;
        let nested;
        try {
          nested = await readdir(absolute, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const child of nested) {
          if (scanned >= MAX_DEPENDENCY_SCAN_ENTRIES) return found;
          scanned += 1;
          const nestedTarget = await readlink(join(absolute, child.name)).catch(() => undefined);
          if (nestedTarget === undefined) continue;
          const nestedReal = await realpath(join(absolute, child.name)).catch(() => undefined);
          if (nestedReal && !isInside(root, nestedReal)) {
            found.push(relative(resolve(worktreePath), join(absolute, child.name)));
          }
        }
        continue;
      }
      const linkReal = await realpath(absolute).catch(() => undefined);
      if (linkReal && !isInside(root, linkReal)) {
        found.push(relative(resolve(worktreePath), absolute));
      }
    }
  }
  return found;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

async function dependencyDirectories(worktreePath: string): Promise<string[]> {
  const directories = [join(worktreePath, NODE_MODULES_DIRECTORY)];
  // Workspace children carry their own node_modules with the same hazard.
  for (const container of ['packages', 'apps']) {
    let entries;
    try {
      entries = await readdir(join(worktreePath, container), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      directories.push(join(worktreePath, container, entry.name, NODE_MODULES_DIRECTORY));
    }
  }
  return directories;
}

function isCommandMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function execAttempt(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  shell: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolveAttempt, rejectAttempt) => {
    execFile(
      input.command,
      input.args,
      {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        shell: input.shell,
        env: { ...process.env, CI: '1' },
        ...(input.signal ? { signal: input.signal } : {}),
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolveAttempt();
          return;
        }
        const detail = String(stderr ?? '').trim();
        if (isCommandMissing(error)) {
          rejectAttempt(new Error(`spawn ${input.command} ENOENT`));
          return;
        }
        rejectAttempt(new Error(detail ? `${error.message}\n${detail}` : error.message));
      },
    );
  });
}

/**
 * Run the install, tolerating the ways a packaged Host can fail to find a
 * package manager: a POSIX manager missing from PATH (fixed by the login-shell
 * merge), a Windows `.cmd` shim that `execFile` cannot run directly, or a
 * Corepack-only install with no top-level shim at all.
 */
const runWithExecFile: WorktreeDependencyCommandRunner = async (input) => {
  const attempts: Array<{ command: string; args: string[]; shell: boolean }> = [
    { command: input.command, args: input.args, shell: false },
  ];
  if (process.platform === 'win32') {
    attempts.push({ command: `${input.command}.cmd`, args: input.args, shell: true });
  }
  attempts.push({ command: 'corepack', args: [input.command, ...input.args], shell: false });

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await execAttempt({
        command: attempt.command,
        args: attempt.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        shell: attempt.shell,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return;
    } catch (error) {
      lastError = error;
      // Only a missing executable justifies the next attempt; a real install
      // failure (bad lockfile, offline registry) is the answer already.
      if (!isCommandMissing(error) && !/ENOENT/.test(formatError(error))) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

function boundedDetail(error: unknown): string {
  const message = formatError(error).trim();
  return message.length > FAILURE_DETAIL_MAX_CHARS
    ? `…${message.slice(-FAILURE_DETAIL_MAX_CHARS)}`
    : message;
}

/**
 * Install the workspace's dependencies. Never throws: a failed install is
 * recorded on the lease and told to the child instead of failing the task.
 */
export async function prepareWorktreeDependencies(input: {
  worktreePath: string;
  parentRepoPath: string;
  /**
   * Fingerprint recorded by the previous task on this workspace. When it still
   * matches, the existing install is kept.
   */
  previousFingerprint?: string | undefined;
  signal?: AbortSignal;
  timeoutMs?: number;
  runCommand?: WorktreeDependencyCommandRunner;
  /** Test seam; production resolves the login-shell PATH once per process. */
  ensurePath?: () => Promise<unknown>;
}): Promise<SubagentWorktreeDependencySetup> {
  if (!(await isDirectory(join(input.parentRepoPath, NODE_MODULES_DIRECTORY)))) {
    return { status: 'skipped', reason: 'parent checkout has no installed dependencies' };
  }
  const plan = await detectWorktreeDependencyInstall(input.worktreePath);
  if (!plan) {
    return { status: 'skipped', reason: 'no supported lockfile' };
  }

  const fingerprint = await computeWorktreeDependencyFingerprint(input.worktreePath);
  const dependenciesPresent = await isDirectory(
    join(input.worktreePath, NODE_MODULES_DIRECTORY),
  );
  if (
    fingerprint !== undefined &&
    dependenciesPresent &&
    input.previousFingerprint !== undefined &&
    input.previousFingerprint === fingerprint
  ) {
    return { status: 'reused', manager: plan.manager, fingerprint };
  }

  const startedAt = Date.now();
  try {
    if (input.signal?.aborted) {
      throw new Error('cancelled before dependency install');
    }
    if (!input.runCommand) {
      await (input.ensurePath ?? ensureLoginShellPath)();
    }
    await (input.runCommand ?? runWithExecFile)({
      command: plan.command,
      args: plan.args,
      cwd: input.worktreePath,
      timeoutMs: input.timeoutMs ?? WORKTREE_DEPENDENCY_INSTALL_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      status: 'installed',
      manager: plan.manager,
      durationMs: Date.now() - startedAt,
      ...(fingerprint !== undefined ? { fingerprint } : {}),
    };
  } catch (error) {
    return {
      status: 'failed',
      manager: plan.manager,
      reason: boundedDetail(error),
      durationMs: Date.now() - startedAt,
      ...(fingerprint !== undefined ? { fingerprint } : {}),
    };
  }
}

/** Seed-prompt guidance matching what the Host did to the workspace. */
export function formatWorktreeDependencyGuidance(
  setup: SubagentWorktreeDependencySetup | undefined,
): string {
  const noSymlink =
    'Never symlink node_modules or other build state to another checkout: packages would ' +
    'resolve to that checkout and your checks would not cover your own changes.';
  if (setup?.status === 'installed') {
    return `Dependencies were installed in this worktree by the Host (${setup.manager}). ${noSymlink}`;
  }
  if (setup?.status === 'reused') {
    return `Dependencies in this workspace are unchanged since the Host installed them (${setup.manager}); they were kept rather than reinstalled. ${noSymlink}`;
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

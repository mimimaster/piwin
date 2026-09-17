/**
 * Auto-approval for `rm -rf` inside a worktree-isolated subagent's own copy.
 *
 * The `rm-recursive-force` prompt guards against accidental deletes; under the
 * `auto` mode every other command is already default-allowed, so this is not a
 * sandbox against a hostile child. A child working in a disposable worktree
 * should not stall on an approval nobody is watching just to clear its own
 * `node_modules`, but a path that escapes the copy (for example through a
 * symlink the child made to the main checkout) must still ask.
 *
 * The check therefore proves every rm target resolves inside the worktree at
 * approval time and refuses any command whose own steps could change that
 * resolution before rm runs. Anything it cannot prove falls back to the prompt.
 */
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';

import { splitBashCommandChain } from './bash-command-chain.js';

const RECURSIVE_FORCE = /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\b/;
/** Commands that can move the cwd or swap a path for a link before rm runs. */
const RESOLUTION_CHANGING = new Set([
  'cd',
  'pushd',
  'popd',
  'ln',
  'mv',
  'cp',
  'rsync',
  'tar',
  'unzip',
  'eval',
  'exec',
  'source',
  '.',
]);
/** Expansion, quoting, redirection and pipes make the real target unknowable. */
const UNSAFE_RM_CHARACTERS = /[$`*?[\]{}~'"<>|&\\()]/;
const RM_FLAG = /^-[rRfvdI]+$|^--(recursive|force|verbose|dir)$/;

export type WorktreeRmApprovalInput = {
  command: string;
  worktreePath: string;
  /** Policy decision for one non-rm step, so another prompt reason is never skipped. */
  evaluateStep: (step: string) => 'allow' | 'ask' | 'deny';
};

export async function isWorktreeConfinedRecursiveRemove(
  input: WorktreeRmApprovalInput,
): Promise<boolean> {
  if (input.command.includes('\\')) return false;
  const steps = input.command
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .flatMap((line) => splitBashCommandChain(line));
  if (steps.length === 0) return false;

  const targets: string[] = [];
  for (const step of steps) {
    const words = step.split(/\s+/);
    const program = words[0] ?? '';
    if (RESOLUTION_CHANGING.has(program)) return false;
    if (!RECURSIVE_FORCE.test(step)) {
      if (input.evaluateStep(step) !== 'allow') return false;
      continue;
    }
    if (program !== 'rm' || UNSAFE_RM_CHARACTERS.test(step)) return false;
    const stepTargets = parseRmTargets(words.slice(1));
    if (!stepTargets) return false;
    targets.push(...stepTargets);
  }
  if (targets.length === 0) return false;

  let worktreeRoot: string;
  try {
    worktreeRoot = await realpath(input.worktreePath);
  } catch {
    return false;
  }
  for (const target of targets) {
    if (!(await resolvesInside(worktreeRoot, target))) return false;
  }
  return true;
}

function parseRmTargets(args: readonly string[]): string[] | undefined {
  const targets: string[] = [];
  let flagsDone = false;
  for (const arg of args) {
    if (!flagsDone && arg === '--') {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && arg.startsWith('-')) {
      if (!RM_FLAG.test(arg)) return undefined;
      continue;
    }
    flagsDone = true;
    if (!isPlainRelativeTarget(arg)) return undefined;
    targets.push(arg);
  }
  return targets.length > 0 ? targets : undefined;
}

function isPlainRelativeTarget(target: string): boolean {
  if (target.length === 0 || isAbsolute(target) || target.startsWith('-')) return false;
  // A trailing slash makes rm follow a symlink and delete what it points at.
  if (target.endsWith('/')) return false;
  const parts = target.split('/');
  return parts.every((part) => part !== '..' && part !== '.git') && normalize(target) !== '.';
}

async function resolvesInside(worktreeRoot: string, target: string): Promise<boolean> {
  const absolute = join(worktreeRoot, target);
  // The last component may be a symlink; rm removes the link itself. Its
  // parent chain must not leave the worktree, so resolve the nearest existing
  // ancestor (missing directories contain no links to follow).
  let ancestor = dirname(absolute);
  for (;;) {
    try {
      const resolved = await realpath(ancestor);
      if (resolved !== worktreeRoot && !resolved.startsWith(worktreeRoot + sep)) return false;
      break;
    } catch (error) {
      if (!isNotFound(error)) return false;
      const parent = dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
  }
  try {
    const meta = await lstat(absolute);
    // Deleting through a real directory is fine; its contents are inside by
    // construction since its own parent chain resolved inside.
    return meta.isDirectory() || meta.isFile() || meta.isSymbolicLink();
  } catch (error) {
    return isNotFound(error);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

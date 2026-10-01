/**
 * Which shell commands still take the workspace-exclusive write lease.
 *
 * Ordinary shell runs optimistically (workspace shared, no file keys) and
 * conflicts are detected afterwards. This short list names commands that
 * rewrite the checkout wholesale — HEAD/index moves, dependency trees,
 * repo-wide formatters — where running beside another session's work does
 * damage no after-the-fact note can repair.
 *
 * A deny-style list is right here, unlike a read-only allowlist: a miss only
 * degrades to the optimistic default every other coding agent ships, and the
 * post-run detection still reports what changed. It errs toward matching —
 * text inside quotes is scanned too, so `bash -c 'git checkout x'` is caught.
 */

export type ShellWriteLockReason = 'git-worktree-state' | 'package-install' | 'repo-formatter';

export type ShellWriteLockDecision =
  | { mode: 'optimistic' }
  | { mode: 'exclusive'; reason: ShellWriteLockReason; command: string };

/**
 * Git subcommands that rewrite working-tree files. `add` and `commit` only
 * touch the index and `.git`, and Git serializes those on its own
 * `index.lock`; listing them made every commit wait for other sessions'
 * tests and then stall everyone queued behind it. (A repository whose commit
 * hooks rewrite files would want them back.)
 */
const GIT_WORKTREE_STATE_SUBCOMMANDS = new Set([
  'am',
  'apply',
  'checkout',
  'cherry-pick',
  'clean',
  'merge',
  'mv',
  'pull',
  'rebase',
  'reset',
  'restore',
  'revert',
  'rm',
  'stash',
  'switch',
]);

/** Git global options that consume the following token. */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun']);

/** Package-manager options that consume the following token. */
const PACKAGE_MANAGER_OPTIONS_WITH_VALUE = new Set([
  '--filter',
  '-F',
  '-C',
  '--dir',
  '--prefix',
  '--cwd',
  '--workspace',
]);

const PACKAGE_INSTALL_SUBCOMMANDS = new Set([
  'add',
  'ci',
  'dedupe',
  'i',
  'install',
  'link',
  'prune',
  'remove',
  'rm',
  'uninstall',
  'unlink',
  'up',
  'update',
  'upgrade',
]);

/** Wrappers whose first non-option argument is the real program. */
const TRANSPARENT_WRAPPERS = new Set([
  'builtin',
  'command',
  'env',
  'exec',
  'nice',
  'nohup',
  'sudo',
  'time',
  'xargs',
]);

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);

/** Runners that execute a package binary: `npx prettier`, `pnpm exec eslint`. */
const BINARY_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const RUNNER_SUBCOMMANDS = new Set(['exec', 'dlx', 'x']);

/**
 * Split on command separators and substitution openers. Quotes are dropped
 * rather than honored so commands nested in `-c '…'` or `$(…)` are scanned.
 */
function splitCommandSegments(command: string): string[][] {
  const flattened = command
    .replace(/\\\n/g, ' ')
    .replace(/["'`]/g, ' ')
    .replace(/\$\(|<\(|>\(|[(){}]/g, ' ; ');
  return flattened
    .split(/&&|\|\||[;|&\n]/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0);
}

function programName(token: string): string {
  const slash = token.lastIndexOf('/');
  return slash >= 0 ? token.slice(slash + 1) : token;
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

/** Strip env assignments, transparent wrappers and `sh -c` down to the program. */
function unwrapProgram(tokens: readonly string[]): string[] {
  let rest = [...tokens];
  for (let guard = 0; guard < 8 && rest.length > 0; guard += 1) {
    const head = rest[0] ?? '';
    const name = programName(head);
    if (isEnvAssignment(head)) {
      rest = rest.slice(1);
    } else if (TRANSPARENT_WRAPPERS.has(name)) {
      rest = rest.slice(1);
      while (rest[0] !== undefined && (rest[0].startsWith('-') || isEnvAssignment(rest[0]))) {
        rest = rest.slice(1);
      }
    } else if (SHELLS.has(name)) {
      const dashC = rest.indexOf('-c');
      if (dashC < 0) {
        return rest;
      }
      rest = rest.slice(dashC + 1);
    } else {
      return rest;
    }
  }
  return rest;
}

function gitSubcommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? '';
    if (GIT_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    return token;
  }
  return undefined;
}

function firstPositional(args: readonly string[]): string | undefined {
  return args.find((token) => !token.startsWith('-'));
}

/** Subcommand after options; `yarn workspace <name> add` resolves to `add`. */
function packageManagerSubcommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? '';
    if (PACKAGE_MANAGER_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    if (token === 'workspace') {
      return packageManagerSubcommand(args.slice(index + 2));
    }
    return token;
  }
  return undefined;
}

/** `npx prettier …`, `pnpm exec prettier …`, `yarn prettier …` → `prettier …`. */
function unwrapBinaryRunner(program: string, args: readonly string[]): string[] | undefined {
  if (BINARY_RUNNERS.has(program)) {
    const index = args.findIndex((token) => !token.startsWith('-'));
    return index < 0 ? undefined : args.slice(index);
  }
  if (PACKAGE_MANAGERS.has(program)) {
    const sub = firstPositional(args);
    if (sub !== undefined && RUNNER_SUBCOMMANDS.has(sub)) {
      const after = args.slice(args.indexOf(sub) + 1);
      const index = after.findIndex((token) => !token.startsWith('-'));
      return index < 0 ? undefined : after.slice(index);
    }
  }
  return undefined;
}

function isRepoFormatter(program: string, args: readonly string[]): boolean {
  if (program === 'prettier') {
    return args.some((token) => token === '--write' || token === '-w');
  }
  if (program === 'eslint') {
    return args.some((token) => token === '--fix' || token.startsWith('--fix='));
  }
  if (program === 'biome') {
    return args.some(
      (token) => token === '--write' || token === '--apply' || token === '--apply-unsafe',
    );
  }
  return false;
}

function classifySegment(tokens: readonly string[]): ShellWriteLockReason | undefined {
  const unwrapped = unwrapProgram(tokens);
  const head = unwrapped[0];
  if (head === undefined) {
    return undefined;
  }
  const program = programName(head);
  const args = unwrapped.slice(1);
  if (program === 'git') {
    const sub = gitSubcommand(args);
    return sub !== undefined && GIT_WORKTREE_STATE_SUBCOMMANDS.has(sub)
      ? 'git-worktree-state'
      : undefined;
  }
  const runnerTarget = unwrapBinaryRunner(program, args);
  if (runnerTarget !== undefined) {
    const [target, ...targetArgs] = runnerTarget;
    return target !== undefined && isRepoFormatter(programName(target), targetArgs)
      ? 'repo-formatter'
      : undefined;
  }
  if (PACKAGE_MANAGERS.has(program)) {
    // Bare `pnpm` / `yarn` / `bun` installs; `pnpm --version` does not.
    if (args.length === 0 && program !== 'npm') {
      return 'package-install';
    }
    const sub = packageManagerSubcommand(args);
    return sub !== undefined && PACKAGE_INSTALL_SUBCOMMANDS.has(sub) ? 'package-install' : undefined;
  }
  return isRepoFormatter(program, args) ? 'repo-formatter' : undefined;
}

export function resolveShellWriteLock(command: string): ShellWriteLockDecision {
  for (const segment of splitCommandSegments(command)) {
    const reason = classifySegment(segment);
    if (reason !== undefined) {
      return { mode: 'exclusive', reason, command: segment.join(' ') };
    }
  }
  return { mode: 'optimistic' };
}

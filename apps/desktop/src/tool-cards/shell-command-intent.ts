/**
 * Shell command intent — what a `bash` call actually does.
 *
 * The call chain folds read-only exploration into one capsule, but the host
 * hands every shell call the same generic `Ran command` verb and `shell` kind.
 * Classifying them all as side-effecting commands broke the explore flow on
 * every `bash grep`, which is why a read → grep → read sweep rendered as
 * `思考过程 → bash → 思考过程 → bash` down the transcript.
 *
 * The classifier is deliberately pessimistic. A segment we cannot name is
 * `unknown`, never `read-only`: silently folding an unrecognized command into
 * "已分析 N 项" hides a side effect behind a read-only label, which is the
 * failure mode Cursor shipped and had to walk back.
 *
 * Pure string analysis — no execution, no filesystem.
 */

export type ShellIntent =
  /** Observes only: search, read, list, inspect. Safe to fold into 分析. */
  | 'read-only'
  /** Tests, builds, type checks, linters. Known, but not exploration. */
  | 'verify'
  /** Writes, installs, network calls, anything with a side effect. */
  | 'mutate'
  /** Unrecognized. Must stay visible on its own row. */
  | 'unknown';

/** Read-only commands split further so the chain can label them truthfully. */
export type ShellReadFacet = 'search' | 'read';

export type ShellCommandClass = {
  intent: ShellIntent;
  /** Only set when `intent` is `read-only`. */
  facet?: ShellReadFacet;
};

/**
 * Least-foldable wins when a line chains several commands: `cat a && rm b` is
 * a mutation, and `cat a && ./unknown.sh` must not fold either.
 */
const SEVERITY: Readonly<Record<ShellIntent, number>> = {
  'read-only': 0,
  verify: 1,
  unknown: 2,
  mutate: 3,
};

const SEARCH_HEADS = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ripgrep', 'ag', 'ack', 'fd', 'fdfind', 'locate',
]);

const READ_HEADS = new Set([
  'ls', 'll', 'tree', 'cat', 'bat', 'head', 'tail', 'wc', 'stat', 'file', 'du', 'df',
  'pwd', 'echo', 'printf', 'basename', 'dirname', 'realpath', 'readlink', 'which',
  'type', 'jq', 'yq', 'sort', 'uniq', 'cut', 'tr', 'column', 'diff', 'cmp', 'date',
  'whoami', 'hostname', 'uname', 'env', 'printenv', 'cd', 'true', 'false', ':',
  // Observes nothing, changes nothing. A pause in a read-only chain must not
  // make the chain unfoldable — `sleep 2 && grep …` is still exploration.
  'sleep',
]);

const VERIFY_HEADS = new Set(['tsc', 'eslint', 'prettier', 'pytest', 'vitest', 'jest', 'mypy', 'ruff']);

const MUTATE_HEADS = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'chgrp', 'ln', 'tee',
  'kill', 'pkill', 'killall', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'sudo', 'doas',
  'docker', 'podman', 'kubectl', 'helm', 'systemctl', 'launchctl', 'brew', 'apt',
  'apt-get', 'dnf', 'pacman', 'gem', 'truncate', 'dd', 'shred', 'open', 'pbcopy',
]);

/** Package-manager subcommands. `run`/`exec` defer to the script name. */
const PM_VERIFY = new Set([
  'test', 'tests', 'lint', 'typecheck', 'type-check', 'tsc', 'build', 'check',
  'vitest', 'jest', 'audit', 'outdated',
]);
const PM_MUTATE = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'ci', 'update', 'upgrade',
  'publish', 'link', 'unlink', 'dlx', 'create', 'init',
]);

const GIT_READ = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'branch', 'remote', 'rev-parse',
  'describe', 'shortlog', 'ls-files', 'ls-tree', 'cat-file', 'grep', 'config',
  'reflog', 'stash', 'worktree', 'tag',
]);
const GIT_MUTATE = new Set([
  'commit', 'push', 'pull', 'fetch', 'checkout', 'switch', 'reset', 'revert',
  'clean', 'rebase', 'merge', 'cherry-pick', 'apply', 'am', 'add', 'mv', 'restore',
  'clone', 'init', 'submodule',
]);

/** Wrappers that pass through to the real command. `sudo` is not one of them. */
const TRANSPARENT_HEADS = new Set(['command', 'nohup', 'time', 'builtin', 'exec', 'xargs']);

type Scan = {
  segments: string[];
  /** A `>` / `>>` to a file anywhere on the line. `2>&1` does not count. */
  hasWriteRedirect: boolean;
  /** Nesting we did not fully unwrap — forces at least `unknown`. */
  hasOpaqueSubstitution: boolean;
};

/**
 * Split a command line into segments on `&&`, `||`, `;`, `|` and newlines,
 * honouring quotes so `grep "a || b" f` stays one segment. Command
 * substitutions become their own segments so `$(rm -rf x)` is judged too.
 */
function scan(command: string): Scan {
  const segments: string[] = [];
  let current = '';
  let hasWriteRedirect = false;
  let hasOpaqueSubstitution = false;
  let quote: "'" | '"' | null = null;
  let index = 0;

  const push = (): void => {
    if (current.trim().length > 0) segments.push(current.trim());
    current = '';
  };

  while (index < command.length) {
    const char = command[index] ?? '';
    const next = command[index + 1] ?? '';

    if (quote !== null) {
      if (char === '\\' && quote === '"') {
        current += char + next;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      current += char;
      index += 1;
      continue;
    }

    if (char === '\\') {
      current += char + next;
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      index += 1;
      continue;
    }

    // Command substitution: judge the inner command as its own segment.
    if ((char === '$' && next === '(') || char === '`') {
      const opener = char === '`' ? '`' : '(';
      const closer = char === '`' ? '`' : ')';
      const start = index + (char === '`' ? 1 : 2);
      let depth = 1;
      let cursor = start;
      while (cursor < command.length && depth > 0) {
        const inner = command[cursor];
        if (inner === opener && opener !== '`') depth += 1;
        else if (inner === closer) depth -= 1;
        cursor += 1;
      }
      if (depth !== 0) {
        hasOpaqueSubstitution = true;
        index = command.length;
        continue;
      }
      const body = command.slice(start, cursor - 1);
      const innerScan = scan(body);
      segments.push(...innerScan.segments);
      if (innerScan.hasWriteRedirect) hasWriteRedirect = true;
      if (innerScan.hasOpaqueSubstitution) hasOpaqueSubstitution = true;
      index = cursor;
      continue;
    }

    if (char === '>') {
      const doubled = next === '>';
      const after = doubled ? (command[index + 2] ?? '') : next;
      // A leading descriptor number (`2>`) belongs to the redirection, not to
      // the command's arguments.
      current = current.replace(/(^|\s)\d$/, '$1');
      if (after !== '&') {
        hasWriteRedirect = true;
        index += doubled ? 2 : 1;
        continue;
      }
      // `2>&1` duplicates a descriptor and writes no file. Swallow the whole
      // token — a stray `1` left behind would parse as an unknown command.
      let cursor = index + (doubled ? 3 : 2);
      while (cursor < command.length && /[0-9-]/.test(command[cursor] ?? '')) cursor += 1;
      index = cursor;
      continue;
    }

    if (char === '\n' || char === ';' || char === '|' || char === '&') {
      // `&&`, `||`, `|`, `;`, newline, and a trailing `&` all end a segment.
      push();
      index += char === next && (char === '&' || char === '|') ? 2 : 1;
      continue;
    }

    current += char;
    index += 1;
  }

  push();
  return { segments, hasWriteRedirect, hasOpaqueSubstitution };
}

/** Tokens of one segment, with leading `NAME=value` assignments dropped. */
function segmentTokens(segment: string): string[] {
  const tokens = segment
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  let start = 0;
  while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start] ?? '')) {
    start += 1;
  }
  return tokens.slice(start);
}

function bareHead(token: string): string {
  // `/usr/bin/grep` and `./node_modules/.bin/tsc` classify by their basename.
  const base = token.split('/').pop() ?? token;
  return base.toLowerCase();
}

function hasFlag(tokens: readonly string[], ...flags: string[]): boolean {
  return tokens.some((token) => flags.includes(token));
}

/** First token that is not a flag, searching after `from`. */
function nextWord(tokens: readonly string[], from: number): string | undefined {
  for (let index = from; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token && !token.startsWith('-')) return token.toLowerCase();
  }
  return undefined;
}

function classifyPackageManager(tokens: readonly string[]): ShellIntent {
  const sub = nextWord(tokens, 1);
  if (sub === undefined) return 'unknown';
  if (PM_MUTATE.has(sub)) return 'mutate';
  if (PM_VERIFY.has(sub)) return 'verify';
  if (sub === 'run' || sub === 'exec') {
    const script = nextWord(tokens, tokens.indexOf(sub) + 1);
    // A script name we recognize is a check; anything else can do anything.
    return script !== undefined && PM_VERIFY.has(script) ? 'verify' : 'unknown';
  }
  return 'unknown';
}

function classifySegment(segment: string): ShellCommandClass {
  const tokens = segmentTokens(segment);
  if (tokens.length === 0) return { intent: 'unknown' };

  let index = 0;
  let head = bareHead(tokens[index] ?? '');
  // Unwrap pass-through wrappers, but never `sudo`: elevation is a side effect.
  while (TRANSPARENT_HEADS.has(head) && index + 1 < tokens.length) {
    index += 1;
    head = bareHead(tokens[index] ?? '');
  }
  const rest = tokens.slice(index);

  if (MUTATE_HEADS.has(head)) return { intent: 'mutate' };

  if (head === 'git') {
    const sub = nextWord(rest, 1);
    if (sub === undefined) return { intent: 'read-only', facet: 'read' };
    if (GIT_MUTATE.has(sub)) return { intent: 'mutate' };
    if (GIT_READ.has(sub)) {
      return { intent: 'read-only', facet: sub === 'grep' ? 'search' : 'read' };
    }
    return { intent: 'unknown' };
  }

  if (head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun' || head === 'npx') {
    return { intent: classifyPackageManager(rest) };
  }

  if (head === 'cargo' || head === 'go' || head === 'make') {
    const sub = nextWord(rest, 1);
    if (sub === undefined) return { intent: 'unknown' };
    if (['test', 'check', 'clippy', 'vet', 'lint', 'typecheck', 'bench'].includes(sub)) {
      return { intent: 'verify' };
    }
    if (['install', 'add', 'publish', 'clean', 'fix', 'get', 'mod'].includes(sub)) {
      return { intent: 'mutate' };
    }
    // `cargo build` / `go build` write artifacts but are still a check step.
    if (sub === 'build') return { intent: 'verify' };
    return { intent: 'unknown' };
  }

  // In-place editors look like readers until you spot the flag.
  if (head === 'sed' || head === 'awk' || head === 'gawk') {
    return hasFlag(rest, '-i', '--in-place') || rest.some((t) => /^-i\S/.test(t))
      ? { intent: 'mutate' }
      : { intent: 'read-only', facet: 'read' };
  }

  // `find -exec` runs arbitrary commands; `-delete` speaks for itself.
  if (head === 'find') {
    return hasFlag(rest, '-delete', '-exec', '-execdir', '-ok', '-okdir')
      ? { intent: 'mutate' }
      : { intent: 'read-only', facet: 'search' };
  }

  if (SEARCH_HEADS.has(head)) return { intent: 'read-only', facet: 'search' };
  if (READ_HEADS.has(head)) return { intent: 'read-only', facet: 'read' };
  if (VERIFY_HEADS.has(head)) return { intent: 'verify' };

  return { intent: 'unknown' };
}

/**
 * Classify a whole command line. Returns the least foldable intent across all
 * its segments, and — only when everything is read-only — whether the line
 * reads as a search or a plain read.
 */
export function classifyShellCommand(command: string | undefined): ShellCommandClass {
  const trimmed = (command ?? '').trim();
  if (trimmed.length === 0) return { intent: 'unknown' };

  const { segments, hasWriteRedirect, hasOpaqueSubstitution } = scan(trimmed);
  if (hasWriteRedirect) return { intent: 'mutate' };
  if (segments.length === 0) return { intent: 'unknown' };

  let worst: ShellIntent = 'read-only';
  let sawSearch = false;
  for (const segment of segments) {
    const result = classifySegment(segment);
    if (result.facet === 'search') sawSearch = true;
    if (SEVERITY[result.intent] > SEVERITY[worst]) worst = result.intent;
  }
  if (hasOpaqueSubstitution && SEVERITY.unknown > SEVERITY[worst]) worst = 'unknown';

  if (worst !== 'read-only') return { intent: worst };
  return { intent: 'read-only', facet: sawSearch ? 'search' : 'read' };
}

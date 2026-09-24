/**
 * Host-level toolchain PATH.
 *
 * A packaged Host is launched by the OS, not by a login shell, so it does not
 * inherit the PATH a user's terminal has. Version managers (fnm, nvm, asdf,
 * volta, Homebrew) install the `node`/`pnpm` the user actually uses into a
 * per-user directory that only the shell rc files add. Without this step every
 * `spawn pnpm` inside the Host fails with ENOENT — which is exactly how child
 * dependency installs were failing, forcing children to improvise by
 * symlinking the main checkout's `node_modules` and thereby verifying code
 * they never changed.
 *
 * The resolution runs once, off the shell's own login rc, and is merged into
 * `process.env.PATH`. That single merge covers both consumers: the dependency
 * installer and every child process the Host spawns afterwards, since workers
 * inherit `process.env.PATH`.
 *
 * Login-shell entries are placed first: the user's own toolchain should win
 * over whatever minimal PATH the OS handed the packaged Host, and a stale
 * `/usr/bin/node` shadowing the user's version manager is the exact failure
 * this exists to prevent. Existing entries are kept, so nothing is removed.
 */
import { execFile } from 'node:child_process';

export const LOGIN_SHELL_PATH_TIMEOUT_MS = 5_000;
/**
 * Interactive rc files print banners, `nvm`/`fnm` notices and stray `echo`s to
 * stdout; framing the value keeps that noise out of PATH.
 */
const PATH_START_MARKER = '__PIWIN_PATH_START__';
const PATH_END_MARKER = '__PIWIN_PATH_END__';
const PATH_PRINT_COMMAND = `printf '%s%s%s' '${PATH_START_MARKER}' "$PATH" '${PATH_END_MARKER}'`;

/** The PATH between the markers, or undefined when the shell never printed it. */
export function extractFramedPath(stdout: string): string | undefined {
  const start = stdout.lastIndexOf(PATH_START_MARKER);
  if (start < 0) return undefined;
  const valueStart = start + PATH_START_MARKER.length;
  const end = stdout.indexOf(PATH_END_MARKER, valueStart);
  if (end < 0) return undefined;
  return stdout.slice(valueStart, end).trim();
}

export type LoginShellPathSource =
  /** Merged entries from the user's login shell. */
  | 'login-shell'
  /** Nothing to add; the current PATH is already sufficient. */
  | 'unchanged'
  /** The shell could not be queried (missing, slow, non-zero exit). */
  | 'unavailable'
  /** Deliberately skipped: Windows, tests, or an explicit opt-out. */
  | 'skipped';

export type ResolvedLoginShellPath = {
  /** Effective PATH after merging. */
  path: string;
  source: LoginShellPathSource;
  /** How many entries the login shell contributed. */
  addedEntryCount: number;
  /** Why resolution was skipped or failed, for diagnostics. */
  reason?: string;
};

export type LoginShellPathRunner = (input: {
  shell: string;
  args: string[];
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}) => Promise<string>;

/** Windows has no POSIX login rc; a `.cmd` shim is handled by the caller. */
export function isLoginShellPathResolutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform === 'win32') return false;
  if (env.NODE_ENV === 'test') return false;
  if (env.PIWIN_SKIP_LOGIN_SHELL_PATH === '1') return false;
  return true;
}

export function pathDelimiterFor(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? ';' : ':';
}

export function parsePathEntries(value: string | undefined, delimiter = pathDelimiterFor()): string[] {
  if (!value) return [];
  return value.split(delimiter).filter((entry) => entry.length > 0);
}

/**
 * Put `preferred` entries ahead of the current ones, de-duplicated.
 * Existing entries are never dropped, only reordered behind the preferred set.
 */
export function mergePathEntries(
  current: string | undefined,
  preferred: readonly string[],
  delimiter = pathDelimiterFor(),
): { path: string; addedEntryCount: number } {
  const existing = parsePathEntries(current, delimiter);
  const existingSet = new Set(existing);
  const additions: string[] = [];
  const seen = new Set<string>();
  for (const entry of preferred) {
    if (!entry || existingSet.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    additions.push(entry);
  }
  return {
    path: [...additions, ...existing].join(delimiter),
    addedEntryCount: additions.length,
  };
}

const runLoginShell: LoginShellPathRunner = (input) =>
  new Promise((resolve, reject) => {
    execFile(
      input.shell,
      input.args,
      {
        timeout: input.timeoutMs,
        maxBuffer: 256 * 1024,
        windowsHide: true,
        env: input.env,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout));
      },
    );
  });

/**
 * Ask the user's login shell for its PATH and merge it into the current one.
 * Never throws: a Host that cannot resolve the shell keeps its own PATH and
 * reports why.
 */
export async function resolveLoginShellPath(options: {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  runShell?: LoginShellPathRunner;
  /** Test seam: pretend to be another platform. */
  platform?: NodeJS.Platform;
} = {}): Promise<ResolvedLoginShellPath> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const current = env.PATH;
  const delimiter = pathDelimiterFor(platform);
  const skipped = (reason: string): ResolvedLoginShellPath => ({
    path: current ?? '',
    source: 'skipped',
    addedEntryCount: 0,
    reason,
  });

  if (platform === 'win32') return skipped('windows has no posix login shell');
  if (env.NODE_ENV === 'test') return skipped('test environment');
  if (env.PIWIN_SKIP_LOGIN_SHELL_PATH === '1') return skipped('disabled by PIWIN_SKIP_LOGIN_SHELL_PATH');

  const shell = env.SHELL?.trim() || '/bin/sh';
  try {
    const stdout = await (options.runShell ?? runLoginShell)({
      shell,
      args: ['-ilc', PATH_PRINT_COMMAND],
      timeoutMs: options.timeoutMs ?? LOGIN_SHELL_PATH_TIMEOUT_MS,
      env,
    });
    const loginEntries = parsePathEntries(extractFramedPath(stdout), delimiter);
    if (loginEntries.length === 0) {
      return {
        path: current ?? '',
        source: 'unavailable',
        addedEntryCount: 0,
        reason: 'login shell reported no PATH',
      };
    }
    const merged = mergePathEntries(current, loginEntries, delimiter);
    return {
      path: merged.path,
      source: merged.addedEntryCount > 0 ? 'login-shell' : 'unchanged',
      addedEntryCount: merged.addedEntryCount,
    };
  } catch (error) {
    return {
      path: current ?? '',
      source: 'unavailable',
      addedEntryCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

let loginShellPathPromise: Promise<ResolvedLoginShellPath> | undefined;

/**
 * Resolve once per process and write the result into `process.env.PATH`.
 *
 * Memoized because the call is on the child-spawn path: a second lookup would
 * add latency to every task for a value that cannot change mid-process.
 */
export function ensureLoginShellPath(options: {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  runShell?: LoginShellPathRunner;
  platform?: NodeJS.Platform;
} = {}): Promise<ResolvedLoginShellPath> {
  loginShellPathPromise ??= resolveLoginShellPath(options).then((resolved) => {
    if (resolved.source === 'login-shell') {
      process.env.PATH = resolved.path;
    }
    return resolved;
  });
  return loginShellPathPromise;
}

/** Test seam: forget the memoized resolution. */
export function resetLoginShellPathForTests(): void {
  loginShellPathPromise = undefined;
}

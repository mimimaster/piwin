/**
 * Thin boundary over `git` CLI execution.
 * Keeps process I/O isolated so status/diff/graph stay pure parsers where possible.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitCommandErrorKind = 'exit' | 'timeout' | 'killed' | 'spawn';

export type RunGitCommandOptions = {
  cwd: string;
  args: string[];
  /** Default 15s. */
  timeoutMs?: number;
  /** When true, non-zero exit still returns stdout/stderr instead of throwing. */
  allowFailure?: boolean;
  /**
   * When set, numeric exits in this set return instead of throwing.
   * Timeout, killed, and spawn never become a successful exit 1.
   */
  allowedExitCodes?: readonly number[];
  /** Additional environment for Git plumbing (for example, an alternate index). */
  env?: Readonly<Record<string, string | undefined>>;
  /** Maximum captured stdout/stderr. Default 4 MiB. */
  maxBufferBytes?: number;
};

export class GitCommandError extends Error {
  readonly name = 'GitCommandError';
  readonly exitCode: number;
  readonly stderr: string;
  readonly args: string[];
  readonly kind: GitCommandErrorKind;

  constructor(
    message: string,
    details: {
      exitCode: number;
      stderr: string;
      args: string[];
      kind: GitCommandErrorKind;
    },
  ) {
    super(message);
    this.exitCode = details.exitCode;
    this.stderr = details.stderr;
    this.args = details.args;
    this.kind = details.kind;
  }
}

type ExecFileFailure = {
  code?: number | string | null;
  killed?: boolean;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  message?: string;
};

export function classifyGitCommandError(err: {
  code?: number | string | null;
  killed?: boolean;
  message?: string;
}): GitCommandErrorKind {
  const message = err.message ?? '';
  const timedOut = err.code === 'ERR_TIMEOUT' || message.includes('TIMEOUT');
  if (err.killed === true && timedOut) {
    return 'timeout';
  }
  if (err.killed === true) {
    return 'killed';
  }
  if (typeof err.code === 'string') {
    return 'spawn';
  }
  if (typeof err.code === 'number') {
    return 'exit';
  }
  return 'spawn';
}

export async function runGitCommand(options: RunGitCommandOptions): Promise<GitCommandResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  try {
    const { stdout, stderr } = await execFileAsync('git', options.args, {
      cwd: options.cwd,
      timeout: timeoutMs,
      maxBuffer: options.maxBufferBytes ?? 4 * 1024 * 1024,
      env: {
        ...process.env,
        ...options.env,
        // Stable machine-readable output
        GIT_TERMINAL_PROMPT: '0',
        LANG: 'C',
      },
    });
    return {
      stdout: typeof stdout === 'string' ? stdout : String(stdout),
      stderr: typeof stderr === 'string' ? stderr : String(stderr),
      exitCode: 0,
    };
  } catch (error) {
    const err = error as ExecFileFailure;
    const stdout = typeof err.stdout === 'string' ? err.stdout : String(err.stdout ?? '');
    const stderr = typeof err.stderr === 'string' ? err.stderr : String(err.stderr ?? '');
    const kind = classifyGitCommandError(err);
    const numericExit = typeof err.code === 'number' ? err.code : undefined;
    const exitCode = numericExit ?? 1;

    if (options.allowedExitCodes) {
      if (
        kind === 'exit' &&
        numericExit !== undefined &&
        options.allowedExitCodes.includes(numericExit)
      ) {
        return { stdout, stderr, exitCode: numericExit };
      }
      throw new GitCommandError(err.message ?? `git ${options.args.join(' ')} failed`, {
        exitCode,
        stderr,
        args: options.args,
        kind,
      });
    }

    if (options.allowFailure) {
      return { stdout, stderr, exitCode };
    }

    throw new GitCommandError(err.message ?? `git ${options.args.join(' ')} failed`, {
      exitCode,
      stderr,
      args: options.args,
      kind,
    });
  }
}

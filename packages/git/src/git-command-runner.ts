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

export type RunGitCommandOptions = {
  cwd: string;
  args: string[];
  /** Default 15s. */
  timeoutMs?: number;
  /** When true, non-zero exit still returns stdout/stderr instead of throwing. */
  allowFailure?: boolean;
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

  constructor(message: string, details: { exitCode: number; stderr: string; args: string[] }) {
    super(message);
    this.exitCode = details.exitCode;
    this.stderr = details.stderr;
    this.args = details.args;
  }
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
    const err = error as {
      code?: number | string;
      killed?: boolean;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stdout = typeof err.stdout === 'string' ? err.stdout : String(err.stdout ?? '');
    const stderr = typeof err.stderr === 'string' ? err.stderr : String(err.stderr ?? '');
    const exitCode = typeof err.code === 'number' ? err.code : 1;

    if (options.allowFailure) {
      return { stdout, stderr, exitCode };
    }

    throw new GitCommandError(err.message ?? `git ${options.args.join(' ')} failed`, {
      exitCode,
      stderr,
      args: options.args,
    });
  }
}

import type { JobController, ToolResult } from '@piwin/contracts';

import { resolveAgentShell } from './windows-bash-shell.js';

const MAX_BASH_OUTPUT_BYTES = 1024 * 1024;
const BASH_STOP_WAIT_MS = 5_000;

export type ManagedBashInput = {
  controller: JobController;
  command: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  runId: string;
  sessionId: string;
  piwinRoot?: string;
};

async function readManagedBashOutput(controller: JobController, jobId: string): Promise<string> {
  const logs = await controller.readLogs({
    jobId,
    maxBytes: MAX_BASH_OUTPUT_BYTES,
  });
  const stdout = logs.chunks
    .filter((chunk) => chunk.stream === 'stdout')
    .map((chunk) => chunk.text)
    .join('');
  const stderr = logs.chunks
    .filter((chunk) => chunk.stream === 'stderr')
    .map((chunk) => chunk.text)
    .join('');
  const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
  return logs.hasMore ? `${output}\n[output truncated]` : output;
}

export async function runManagedBash(input: ManagedBashInput): Promise<ToolResult> {
  if (input.signal.aborted) {
    return { ok: false, code: 'aborted', message: 'tool execution aborted' };
  }

  const invocation = resolveAgentShell(input.command, input.piwinRoot);
  let job;
  try {
    job = await input.controller.start({
      kind: 'command',
      lifetime: 'run',
      command: invocation.command,
      argv: invocation.argv,
      cwd: input.cwd,
      ownerRunId: input.runId,
      ownerSessionId: input.sessionId,
      ownerProjectPath: input.cwd,
      label: 'bash',
    });
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'execution-failed',
      message: `failed to start shell command: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }

  const waitAbort = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(
    () => {
      timedOut = true;
      waitAbort.abort();
    },
    Math.max(1, input.timeoutMs),
  );
  const onAbort = (): void => waitAbort.abort();
  input.signal.addEventListener('abort', onAbort, { once: true });

  try {
    let record;
    try {
      record = await input.controller.wait(
        { jobId: job.jobId, timeoutMs: input.timeoutMs + BASH_STOP_WAIT_MS },
        waitAbort.signal,
      );
    } catch (error: unknown) {
      const stopReason = input.signal.aborted ? 'run-cancelled' : 'user-stop';
      let stopError: string | undefined;
      try {
        await input.controller.stop(job.jobId, stopReason);
      } catch (stopFailure: unknown) {
        stopError = stopFailure instanceof Error ? stopFailure.message : String(stopFailure);
      }
      const output = await readManagedBashOutput(input.controller, job.jobId);
      if (input.signal.aborted) {
        return { ok: false, code: 'aborted', message: 'tool execution aborted' };
      }
      const reason = timedOut
        ? `shell command timed out after ${input.timeoutMs}ms`
        : `shell command failed to finish: ${error instanceof Error ? error.message : String(error)}`;
      return {
        ok: false,
        code: 'execution-failed',
        message: [reason, stopError ? `cleanup failed: ${stopError}` : '', output]
          .filter(Boolean)
          .join('\n'),
        retryable: true,
      };
    }

    const output = await readManagedBashOutput(input.controller, job.jobId);
    if (record.status === 'exited' && record.exitCode === 0) {
      return { ok: true, output };
    }
    return {
      ok: false,
      code: 'execution-failed',
      message: [`shell command exited with code ${record.exitCode ?? 'unknown'}`, output]
        .filter(Boolean)
        .join('\n'),
      retryable: true,
    };
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener('abort', onAbort);
  }
}

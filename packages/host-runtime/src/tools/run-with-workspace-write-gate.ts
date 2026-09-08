/**
 * Acquire the workspace write gate around a Host filesystem/shell executor.
 * Permission admission happens before this helper; abort is rechecked after wait.
 */
import { resolveFileLockKey } from '@piwin/git';
import type { ToolResult } from '@piwin/contracts';
import type {
  WorkspaceWriteAcquireInput,
  WorkspaceWriteGate,
} from '../turn-changes/workspace-write-gate.js';

export type WorkspaceWriteBinding = {
  gate: WorkspaceWriteGate;
  workspaceId: string;
  rootPath: string;
};

export async function runWithWorkspaceWriteGate(input: {
  workspaceWrite: WorkspaceWriteBinding | undefined;
  runId: string;
  signal: AbortSignal;
  mode: WorkspaceWriteAcquireInput['mode'];
  wait: boolean;
  filePath?: string;
  run: () => Promise<ToolResult>;
}): Promise<ToolResult> {
  if (!input.workspaceWrite) {
    return input.run();
  }
  if (input.signal.aborted) {
    return { ok: false, code: 'aborted', message: 'tool execution aborted' };
  }

  let paths: string[] | undefined;
  if (input.mode === 'shared') {
    const filePath = input.filePath;
    if (!filePath) {
      throw new Error('shared workspace write requires filePath');
    }
    const resolved = await resolveFileLockKey(filePath);
    if (!resolved.ok) {
      return {
        ok: false,
        code: 'execution-failed',
        message: `invalid write path: ${resolved.reason}`,
      };
    }
    paths = [resolved.key];
  }

  const acquired = await input.workspaceWrite.gate.tryAcquire({
    workspaceId: input.workspaceWrite.workspaceId,
    rootPath: input.workspaceWrite.rootPath,
    kind: 'tool',
    mode: input.mode,
    wait: input.wait,
    runId: input.runId,
    signal: input.signal,
    ...(paths ? { paths } : {}),
  });
  if (!acquired.ok) {
    if (acquired.reason === 'aborted') {
      return { ok: false, code: 'aborted', message: 'tool execution aborted' };
    }
    return { ok: false, code: 'execution-failed', message: acquired.reason };
  }

  try {
    if (input.signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted' };
    }
    if (input.mode === 'shared' && input.filePath && paths) {
      const again = await resolveFileLockKey(input.filePath);
      if (!again.ok || again.key !== paths[0]) {
        return {
          ok: false,
          code: 'execution-failed',
          message: 'write path identity changed before write',
        };
      }
    }
    return await input.run();
  } finally {
    acquired.lease.release();
  }
}

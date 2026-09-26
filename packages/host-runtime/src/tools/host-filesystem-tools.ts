/**
 * Host-owned filesystem + bash tools for worker sessions.
 *
 * These are Host registrations (not Pi-native customTools) that execute
 * in the parent process through the `SessionHostToolExecutionPort`. The
 * worker calls them via the tool proxy; the parent validates identity and
 * generation before routing to the concrete executor here.
 *
 * Pi built-ins remain owned by the Pi backend. These registrations are the
 * parent-owned surface used by both SDK and worker/RPC paths; the worker never
 * executes filesystem or process side effects locally.
 *
 * Authority: @piwin/host-runtime (product composition root).
 * Invariant: every side effect goes through the permission gate.
 */

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HostToolRegistration, JobController, ToolResult } from '@piwin/contracts';
import {
  assertSafeRepoRelativePaths,
  deleteTurnChangeFile,
  writeTurnChangeFile,
  type TurnChangeObjectStore,
  type TurnChangeWriteReceipt,
} from '@piwin/git';
import type { WorkspaceWriteGate } from '../turn-changes/workspace-write-gate.js';
import { runWithWorkspaceWriteGate } from './run-with-workspace-write-gate.js';
import { runManagedBash } from './run-managed-bash.js';
import { resolveAgentShell } from './windows-bash-shell.js';

const execFileAsync = promisify(execFile);
const utf8 = new TextEncoder();

export type BuildHostFilesystemToolsOptions = {
  /** Session working directory (project root or general workspace). */
  cwd: string;
  piwinRoot?: string;
  /** Host-owned Job authority for shell process-tree lifecycle. */
  jobController?: JobController;
  turnChange?: {
    workspaceRoot: string;
    store: TurnChangeObjectStore;
    onReceipt?: (receipt: TurnChangeWriteReceipt) => void;
  };
  workspaceWrite?: {
    gate: WorkspaceWriteGate;
    workspaceId: string;
    rootPath: string;
  };
};

/**
 * Build Host-owned filesystem tools: `read_file`, `write_file`,
 * `delete_file`, `list_directory`, and `bash` / `run_bash`.
 *
 * Permission admission is performed by the Host router before execution.
 * Read-only tools still use the same router path, while executors only
 * validate arguments and perform the filesystem operation.
 *
 * Paths are resolved relative to `cwd`. Writes that escape the project root
 * are flagged by the evaluator.
 */
export function buildHostFilesystemTools(
  options: BuildHostFilesystemToolsOptions,
): HostToolRegistration[] {
  const { cwd, jobController, turnChange, workspaceWrite, piwinRoot } = options;

  function resolvePath(path: string): string {
    return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  }

  const readFileTool: HostToolRegistration = {
    descriptor: {
      name: 'read_file',
      description:
        'Read the contents of a file. Paths are relative to the session working directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative or absolute)' },
        },
        required: ['path'],
      },
    },
    family: 'filesystem-read',
    permissionSpec: {
      action: 'filesystem:read',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    fileEffect: { kind: 'none' },
    prepareArgs: (rawArguments, _context, signal) =>
      prepareResolvedPath(rawArguments, resolvePath, signal, { required: true }),
    async execute(args) {
      const filePath = String(args.path ?? '');
      const content = await readFile(filePath, 'utf-8');
      return { ok: true, output: content };
    },
  };

  const writeFileTool: HostToolRegistration = {
    descriptor: {
      name: 'write_file',
      description:
        'Write content to a file (creates or overwrites). Paths are relative to the session working directory. Subject to permission policy.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative or absolute)' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
    family: 'filesystem-write',
    permissionSpec: {
      action: 'file-write',
      risk: 'file-write',
      rememberable: true,
      subjectBuilder: (args) => ({
        kind: 'file-write',
        path: String(args.path ?? ''),
      }),
    },
    fileEffect: {
      kind: 'exact-paths',
      pathsFromArgs: (args) => [String(args.path)],
    },
    prepareArgs: (rawArguments, _context, signal) =>
      prepareResolvedPath(rawArguments, resolvePath, signal, { required: true }),
    async execute(args, signal, context) {
      const filePath = String(args.path ?? '');
      return runWithWorkspaceWriteGate({
        workspaceWrite,
        runId: context.runId,
        signal,
        mode: 'shared',
        wait: true,
        filePath,
        run: async () => {
          if (!turnChange) {
            const dir = join(filePath, '..');
            await mkdir(dir, { recursive: true });
            await writeFile(filePath, String(args.content ?? ''), 'utf-8');
            return { ok: true, output: `Wrote ${filePath}` };
          }
          const relativePath = toTurnChangeRelativePath(filePath, turnChange.workspaceRoot);
          const receipt = await writeTurnChangeFile({
            workspaceRoot: turnChange.workspaceRoot,
            relativePath,
            bytes: utf8.encode(String(args.content ?? '')),
            store: turnChange.store,
          });
          turnChange.onReceipt?.(receipt);
          return { ok: true, output: `Wrote ${filePath}` };
        },
      });
    },
  };

  const deleteFileTool: HostToolRegistration = {
    descriptor: {
      name: 'delete_file',
      description:
        'Delete a file. Paths are relative to the session working directory. Subject to permission policy.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative or absolute)' },
        },
        required: ['path'],
      },
    },
    family: 'filesystem-write',
    permissionSpec: {
      action: 'file-write',
      risk: 'file-write',
      rememberable: true,
      subjectBuilder: (args) => ({
        kind: 'file-write',
        path: String(args.path ?? ''),
      }),
    },
    fileEffect: {
      kind: 'exact-paths',
      pathsFromArgs: (args) => [String(args.path)],
    },
    prepareArgs: (rawArguments, _context, signal) =>
      prepareResolvedPath(rawArguments, resolvePath, signal, { required: true }),
    async execute(args, signal, context) {
      const filePath = String(args.path ?? '');
      return runWithWorkspaceWriteGate({
        workspaceWrite,
        runId: context.runId,
        signal,
        mode: 'shared',
        wait: true,
        filePath,
        run: async () => {
          if (!turnChange) {
            await unlink(filePath);
            return { ok: true, output: `Deleted ${filePath}` };
          }
          const relativePath = toTurnChangeRelativePath(filePath, turnChange.workspaceRoot);
          const receipt = await deleteTurnChangeFile({
            workspaceRoot: turnChange.workspaceRoot,
            relativePath,
            store: turnChange.store,
          });
          turnChange.onReceipt?.(receipt);
          return { ok: true, output: `Deleted ${filePath}` };
        },
      });
    },
  };

  const listDirectoryTool: HostToolRegistration = {
    descriptor: {
      name: 'list_directory',
      description:
        'List entries in a directory. Returns names with kind (file/directory). Paths are relative to the session working directory.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path (relative or absolute). Defaults to cwd.',
          },
        },
      },
    },
    family: 'filesystem-read',
    permissionSpec: {
      action: 'filesystem:list',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    fileEffect: { kind: 'none' },
    prepareArgs: (rawArguments, _context, signal) =>
      prepareResolvedPath(rawArguments, resolvePath, signal, {
        required: false,
        defaultPath: cwd,
      }),
    async execute(args) {
      const dirPath = String(args.path ?? cwd);
      const entries = await readdir(dirPath, { withFileTypes: true });
      const result = entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
      }));
      return { ok: true, output: JSON.stringify(result, null, 2) };
    },
  };

  const bashTool: HostToolRegistration = {
    descriptor: {
      name: 'bash',
      description:
        'Execute a bash command. Subject to permission policy (destructive commands may prompt). Output is stdout+stderr combined.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Bash command to execute' },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default 30000)',
          },
        },
        required: ['command'],
      },
    },
    family: 'shell',
    permissionSpec: {
      action: 'bash',
      risk: 'command',
      rememberable: false,
      subjectBuilder: (args) => ({ kind: 'bash', command: String(args.command ?? '') }),
    },
    fileEffect: { kind: 'uncontained' },
    prepareArgs: (rawArguments, _context, signal) => prepareBashArgs(rawArguments, signal),
    async execute(args, signal, context) {
      return runWithWorkspaceWriteGate({
        workspaceWrite,
        runId: context.runId,
        signal,
        mode: 'exclusive',
        wait: true,
        run: async () => {
          const command = String(args.command ?? '');
          const timeout = typeof args.timeout === 'number' ? args.timeout : 30000;
          if (jobController) {
            return runManagedBash({
              controller: jobController,
              command,
              cwd,
              timeoutMs: timeout,
              signal,
              runId: context.runId,
              sessionId: context.sessionId,
              ...(piwinRoot ? { piwinRoot } : {}),
            });
          }
          const invocation = resolveAgentShell(command, piwinRoot);
          const { stdout, stderr } = await execFileAsync(invocation.command, invocation.argv, {
            cwd,
            timeout,
            windowsHide: true,
            ...(signal ? { signal } : {}),
            maxBuffer: 1024 * 1024,
          });
          return { ok: true, output: stdout + (stderr ? `\n[stderr]\n${stderr}` : '') };
        },
      });
    },
  };

  const runBashTool: HostToolRegistration = {
    descriptor: {
      name: 'run_bash',
      description: 'Execute a bash command (alias of bash). Subject to permission policy.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Bash command to execute' },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default 30000)',
          },
        },
        required: ['command'],
      },
    },
    family: 'shell',
    permissionSpec: {
      action: 'bash',
      risk: 'command',
      rememberable: false,
      subjectBuilder: (args) => ({ kind: 'bash', command: String(args.command ?? '') }),
    },
    fileEffect: { kind: 'uncontained' },
    prepareArgs: (rawArguments, _context, signal) => prepareBashArgs(rawArguments, signal),
    async execute(args, signal, context) {
      return runWithWorkspaceWriteGate({
        workspaceWrite,
        runId: context.runId,
        signal,
        mode: 'exclusive',
        wait: true,
        run: async () => {
          const command = String(args.command ?? '');
          const timeout = typeof args.timeout === 'number' ? args.timeout : 30000;
          if (jobController) {
            return runManagedBash({
              controller: jobController,
              command,
              cwd,
              timeoutMs: timeout,
              signal,
              runId: context.runId,
              sessionId: context.sessionId,
              ...(piwinRoot ? { piwinRoot } : {}),
            });
          }
          const invocation = resolveAgentShell(command, piwinRoot);
          const { stdout, stderr } = await execFileAsync(invocation.command, invocation.argv, {
            cwd,
            timeout,
            windowsHide: true,
            ...(signal ? { signal } : {}),
            maxBuffer: 1024 * 1024,
          });
          return { ok: true, output: stdout + (stderr ? `\n[stderr]\n${stderr}` : '') };
        },
      });
    },
  };

  return [readFileTool, writeFileTool, deleteFileTool, listDirectoryTool, bashTool, runBashTool];
}

function toTurnChangeRelativePath(absolutePath: string, workspaceRoot: string): string {
  const rel = relative(resolve(workspaceRoot), resolve(absolutePath)).split('\\').join('/');
  const safe = assertSafeRepoRelativePaths(workspaceRoot, [rel]);
  const relativePath = safe[0];
  if (relativePath === undefined) {
    throw new Error('path escapes workspace');
  }
  return relativePath;
}

function prepareResolvedPath(
  rawArguments: Record<string, unknown>,
  resolvePath: (path: string) => string,
  signal: AbortSignal,
  options: { required: boolean; defaultPath?: string },
): { ok: true; arguments: Record<string, unknown> } | { ok: false; result: ToolResult } {
  if (signal.aborted) {
    return { ok: false, result: { ok: false, code: 'aborted', message: 'tool preparation aborted' } };
  }
  const rawPath = rawArguments.path;
  if (rawPath === undefined || rawPath === null || rawPath === '') {
    if (!options.required && options.defaultPath !== undefined) {
      return { ok: true, arguments: { ...rawArguments, path: options.defaultPath } };
    }
    return { ok: false, result: { ok: false, code: 'invalid-input', message: 'path is required' } };
  }
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return { ok: false, result: { ok: false, code: 'invalid-input', message: 'path is required' } };
  }
  return { ok: true, arguments: { ...rawArguments, path: resolvePath(rawPath.trim()) } };
}

function prepareBashArgs(
  rawArguments: Record<string, unknown>,
  signal: AbortSignal,
): { ok: true; arguments: Record<string, unknown> } | { ok: false; result: ToolResult } {
  if (signal.aborted) {
    return { ok: false, result: { ok: false, code: 'aborted', message: 'tool preparation aborted' } };
  }
  if (typeof rawArguments.command !== 'string' || rawArguments.command.trim().length === 0) {
    return {
      ok: false,
      result: { ok: false, code: 'invalid-input', message: 'command is required' },
    };
  }
  return {
    ok: true,
    arguments: { ...rawArguments, command: rawArguments.command.trim() },
  };
}

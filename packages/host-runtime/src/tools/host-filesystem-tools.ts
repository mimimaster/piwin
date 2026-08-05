/**
 * Host-owned filesystem + bash tools for worker sessions.
 *
 * These are `HostToolDefinition[]` (not Pi-native customTools) that execute
 * in the parent process through the `SessionHostToolExecutionPort`. The
 * worker calls them via the tool proxy; the parent validates identity and
 * generation before routing to the concrete executor here.
 *
 * This is distinct from `gated-bash-tool.ts` / `gated-file-tools.ts`, which
 * produce Pi-native customTools for the SDK (in-process) path. Those override
 * Pi's built-in `bash`/`write`/`edit` by name. The tools here are additional
 * Host tools that exist only in the worker/RPC manifest — they do not replace
 * Pi built-ins but supplement them with parent-owned executors.
 *
 * Authority: @piwin/host-runtime (product composition root).
 * Invariant: every side effect goes through the permission gate.
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { HostToolDefinition } from '@piwin/tools-web';
import type { PermissionDecision, PermissionMode, PermissionRuleSet } from '@piwin/contracts';
import {
  evaluateBashPermission,
  evaluateFileWritePermission,
  resolveNonInteractiveDecision,
} from '../permission-policy.js';
import type { ToolPermissionGate } from '../session-tools.js';

const execAsync = promisify(exec);

export type BuildHostFilesystemToolsOptions = {
  /** Session working directory (project root or general workspace). */
  cwd: string;
  /** Permission mode from config. */
  permissionMode?: PermissionMode;
  /** Dynamic permission mode getter. */
  getPermissionMode?: () => PermissionMode;
  /** Merged permission rule set. */
  rules?: PermissionRuleSet;
  /** Interactive permission gate (Desktop via HostRuntime). */
  requestPermission?: ToolPermissionGate;
};

/**
 * Build Host-owned filesystem tools: `read_file`, `write_file`,
 * `list_directory`, and `bash` / `run_bash`.
 *
 * Each tool enforces permission policy before executing:
 * - `bash` / `run_bash`: `evaluateBashPermission` → ask gate
 * - `write_file`: `evaluateFileWritePermission` → ask gate
 * - `read_file` / `list_directory`: no permission gate (read-only)
 *
 * Paths are resolved relative to `cwd`. Writes that escape the project root
 * are flagged by the evaluator.
 */
export function buildHostFilesystemTools(
  options: BuildHostFilesystemToolsOptions,
): HostToolDefinition[] {
  const {
    cwd,
    requestPermission,
    rules,
  } = options;

  const staticMode = options.permissionMode ?? 'auto';
  const getMode = options.getPermissionMode;

  function effectiveMode(): PermissionMode {
    return getMode ? getMode() : staticMode;
  }

  async function gateBash(command: string, signal?: AbortSignal): Promise<void> {
    const evaluation = evaluateBashPermission(command, effectiveMode(), rules);
    let decision: PermissionDecision = evaluation.decision;
    if (decision === 'ask') {
      if (requestPermission) {
        decision = await requestPermission({
          action: 'bash',
          detail: `${evaluation.reason}: ${command}`,
          defaultDecision: 'ask',
          ...(signal ? { signal } : {}),
        });
      } else {
        decision = resolveNonInteractiveDecision(evaluation);
      }
    }
    if (decision !== 'allow') {
      throw new Error(`piwin blocked bash (${evaluation.reason}): ${command}`);
    }
  }

  async function gateFileWrite(absPath: string, signal?: AbortSignal): Promise<void> {
    const evaluation = evaluateFileWritePermission({
      absPath,
      projectRoot: cwd,
      mode: effectiveMode(),
      ...(rules ? { rules } : {}),
    });
    let decision: PermissionDecision = evaluation.decision;
    if (decision === 'ask') {
      if (requestPermission) {
        decision = await requestPermission({
          action: 'file-write',
          detail: absPath,
          defaultDecision: 'ask',
          ...(signal ? { signal } : {}),
        });
      } else {
        decision = resolveNonInteractiveDecision(evaluation);
      }
    }
    if (decision !== 'allow') {
      throw new Error(`piwin blocked file-write (${evaluation.reason}): ${absPath}`);
    }
  }

  function resolvePath(path: string): string {
    return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  }

  const readFileTool: HostToolDefinition = {
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
    async execute(args, signal) {
      const filePath = resolvePath(String(args.path ?? ''));
      const content = await readFile(filePath, 'utf-8');
      return content;
    },
  };

  const writeFileTool: HostToolDefinition = {
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
    async execute(args, signal) {
      const filePath = resolvePath(String(args.path ?? ''));
      await gateFileWrite(filePath, signal);
      const dir = join(filePath, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, String(args.content ?? ''), 'utf-8');
      return `Wrote ${filePath}`;
    },
  };

  const listDirectoryTool: HostToolDefinition = {
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
    async execute(args) {
      const dirPath = args.path ? resolvePath(String(args.path)) : cwd;
      const entries = await readdir(dirPath, { withFileTypes: true });
      const result = entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
      }));
      return JSON.stringify(result, null, 2);
    },
  };

  const bashTool: HostToolDefinition = {
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
    async execute(args, signal) {
      const command = String(args.command ?? '');
      await gateBash(command, signal);
      const timeout = typeof args.timeout === 'number' ? args.timeout : 30000;
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        ...(signal ? { signal } : {}),
        maxBuffer: 1024 * 1024,
      });
      return stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
    },
  };

  const runBashTool: HostToolDefinition = {
    name: 'run_bash',
    description:
      'Execute a bash command (alias of bash). Subject to permission policy.',
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
    async execute(args, signal) {
      const command = String(args.command ?? '');
      await gateBash(command, signal);
      const timeout = typeof args.timeout === 'number' ? args.timeout : 30000;
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        ...(signal ? { signal } : {}),
        maxBuffer: 1024 * 1024,
      });
      return stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
    },
  };

  return [readFileTool, writeFileTool, listDirectoryTool, bashTool, runBashTool];
}

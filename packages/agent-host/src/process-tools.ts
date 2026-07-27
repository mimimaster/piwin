/**
 * Host customTools for managed processes (CE-PROC).
 * process_start | process_list | process_logs | process_stop
 */
import type { PermissionDecision } from '@piwin/contracts';
import type { ProcessRegistry } from '@piwin/process';
import type { HostToolDefinition } from '@piwin/tools-web';
import {
  evaluateProcessPermission,
  resolveNonInteractiveDecision,
} from './permission-policy.js';

export type ProcessToolPermissionGate = (input: {
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  signal?: AbortSignal;
}) => Promise<PermissionDecision>;

export type BuildProcessToolsOptions = {
  registry: ProcessRegistry;
  requestPermission?: ProcessToolPermissionGate;
  /** Default sessionId attached when tool omits it. */
  sessionId?: string;
  /** Default projectPath / cwd when tool omits them. */
  projectPath?: string;
};

/**
 * Build process_* tools for Pi customTools registration.
 * Permission: process:start and process:stop default to ask.
 */
export function buildProcessTools(options: BuildProcessToolsOptions): HostToolDefinition[] {
  const { registry, requestPermission, sessionId, projectPath } = options;

  async function gate(
    action: 'process:start' | 'process:stop',
    detail: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const evaluation = evaluateProcessPermission(action);
    let decision: PermissionDecision = evaluation.decision;
    if (decision === 'ask') {
      if (requestPermission) {
        decision = await requestPermission({
          action,
          detail,
          defaultDecision: 'ask',
          ...(signal ? { signal } : {}),
        });
      } else {
        decision = resolveNonInteractiveDecision(evaluation);
      }
    }
    if (decision !== 'allow') {
      throw new Error(`Permission ${decision} for ${action}: ${detail.slice(0, 160)}`);
    }
  }

  const startTool: HostToolDefinition = {
    name: 'process_start',
    description:
      'Start a long-running managed process (dev server, watcher). Uses argv array only — no shell. cwd must be inside a trusted project. Prefer this over bash for processes that should outlive a single tool call.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Executable to run (no shell)' },
        argv: {
          type: 'array',
          items: { type: 'string' },
          description: 'Argument list after the executable',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (must be under a trusted project)',
        },
        label: { type: 'string', description: 'Optional short label for UI' },
      },
      required: ['command', 'argv', 'cwd'],
    },
    async execute(args, signal) {
      const command = String(args.command ?? '');
      const argvRaw = args.argv;
      const argv = Array.isArray(argvRaw)
        ? argvRaw.map((item) => String(item))
        : [];
      const cwd = String(args.cwd ?? projectPath ?? '');
      const label = args.label !== undefined ? String(args.label) : undefined;
      await gate('process:start', `${command} ${argv.join(' ')} @ ${cwd}`, signal);
      const startInput: Parameters<ProcessRegistry['start']>[0] = {
        command,
        argv,
        cwd,
      };
      if (sessionId) startInput.sessionId = sessionId;
      if (projectPath) startInput.projectPath = projectPath;
      if (label) startInput.label = label;
      const record = await registry.start(startInput);
      return JSON.stringify(record, null, 2);
    },
  };

  const listTool: HostToolDefinition = {
    name: 'process_list',
    description: 'List managed processes (running and recently exited).',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Optional filter by session' },
        projectPath: { type: 'string', description: 'Optional filter by project' },
      },
    },
    async execute(args) {
      const filter: { sessionId?: string; projectPath?: string } = {};
      if (typeof args.sessionId === 'string') filter.sessionId = args.sessionId;
      else if (sessionId) filter.sessionId = sessionId;
      if (typeof args.projectPath === 'string') filter.projectPath = args.projectPath;
      else if (projectPath) filter.projectPath = projectPath;
      const processes = registry.list(
        Object.keys(filter).length > 0 ? filter : undefined,
      );
      return JSON.stringify({ processes }, null, 2);
    },
  };

  const logsTool: HostToolDefinition = {
    name: 'process_logs',
    description: 'Read recent stdout/stderr logs for a managed process (secrets redacted).',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'Managed process id' },
        offset: { type: 'number', description: 'Chunk offset (default 0)' },
        limit: { type: 'number', description: 'Max chunks (default all)' },
      },
      required: ['processId'],
    },
    async execute(args) {
      const processId = String(args.processId ?? '');
      if (!processId) {
        throw new Error('processId is required');
      }
      const query: Parameters<ProcessRegistry['readLogs']>[0] = { processId };
      if (typeof args.offset === 'number') query.offset = args.offset;
      if (typeof args.limit === 'number') query.limit = args.limit;
      const chunks = registry.readLogs(query);
      return JSON.stringify({ processId, chunks }, null, 2);
    },
  };

  const stopTool: HostToolDefinition = {
    name: 'process_stop',
    description: 'Stop a managed process (SIGTERM, then SIGKILL after grace).',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'Managed process id' },
      },
      required: ['processId'],
    },
    async execute(args, signal) {
      const processId = String(args.processId ?? '');
      if (!processId) {
        throw new Error('processId is required');
      }
      await gate('process:stop', processId, signal);
      const record = await registry.stop(processId);
      return JSON.stringify(record, null, 2);
    },
  };

  return [startTool, listTool, logsTool, stopTool];
}

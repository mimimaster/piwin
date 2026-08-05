/**
 * Host custom tools for JobController-backed process operations.
 *
 * The model-facing names remain `process_*` for product continuity, but every
 * input and output uses the native Job contracts. There is no legacy process
 * record projection between the tools and JobController.
 */
import type {
  JobController,
  JobKind,
  JobLifetime,
  PermissionDecision,
  StartJobInput,
} from '@piwin/contracts';
import type { HostToolDefinition } from '@piwin/tools-web';
import {
  evaluateProcessPermission,
  resolveNonInteractiveDecision,
} from './permission-policy.js';
import { HOST_TOOL_RUN_ID_ARGUMENT } from './tools/host-tool-execution-context.js';

export type ProcessToolPermissionGate = (input: {
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  signal?: AbortSignal;
}) => Promise<PermissionDecision>;

export type BuildProcessToolsOptions = {
  /** Single Host Job authority. */
  jobController: JobController;
  requestPermission?: ProcessToolPermissionGate;
  /** Default session id for session-scoped Jobs and list filters. */
  sessionId?: string;
  /** Default trusted project path for project-scoped Jobs and list filters. */
  projectPath?: string;
};

function readStringArgument(argumentsObject: Record<string, unknown>, name: string): string {
  return typeof argumentsObject[name] === 'string' ? argumentsObject[name] as string : '';
}

function readOptionalStringArgument(
  argumentsObject: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = argumentsObject[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArrayArgument(
  argumentsObject: Record<string, unknown>,
  name: string,
): string[] {
  const value = argumentsObject[name];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function readJobKind(argumentsObject: Record<string, unknown>): JobKind {
  return argumentsObject.kind === 'command' ? 'command' : 'service';
}

function readJobLifetime(argumentsObject: Record<string, unknown>): JobLifetime {
  const value = argumentsObject.lifetime;
  if (value === 'session' || value === 'host') {
    return value;
  }
  return 'run';
}

function readRunId(argumentsObject: Record<string, unknown>): string | undefined {
  return readOptionalStringArgument(argumentsObject, HOST_TOOL_RUN_ID_ARGUMENT);
}

function createStartJobInput(
  argumentsObject: Record<string, unknown>,
  defaults: Pick<BuildProcessToolsOptions, 'projectPath' | 'sessionId'>,
): StartJobInput {
  const command = readStringArgument(argumentsObject, 'command');
  const argv = readStringArrayArgument(argumentsObject, 'argv');
  const cwd = readStringArgument(argumentsObject, 'cwd') || defaults.projectPath || process.cwd();
  const lifetime = readJobLifetime(argumentsObject);
  const startInput: StartJobInput = {
    kind: readJobKind(argumentsObject),
    lifetime,
    command,
    argv,
    cwd,
  };

  const label = readOptionalStringArgument(argumentsObject, 'label');
  if (label) {
    startInput.label = label;
  }

  if (lifetime === 'run') {
    const runId = readRunId(argumentsObject);
    if (!runId) {
      throw new Error('process_start requires a Host run context for run-lifetime Jobs');
    }
    startInput.ownerRunId = runId;
    if (defaults.sessionId) {
      startInput.ownerSessionId = defaults.sessionId;
    }
  } else if (lifetime === 'session') {
    if (!defaults.sessionId) {
      throw new Error('session-lifetime Jobs require an active session');
    }
    startInput.ownerSessionId = defaults.sessionId;
  }

  if (defaults.projectPath) {
    startInput.ownerProjectPath = defaults.projectPath;
  }

  return startInput;
}

/** Build the four JobController-backed process tools. */
export function buildProcessTools(options: BuildProcessToolsOptions): HostToolDefinition[] {
  const { jobController, requestPermission, projectPath, sessionId } = options;

  async function gate(
    action: 'process:start' | 'process:stop',
    detail: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const evaluation = evaluateProcessPermission(action);
    let decision: PermissionDecision = evaluation.decision;
    if (decision === 'ask') {
      decision = requestPermission
        ? await requestPermission({
            action,
            detail,
            defaultDecision: 'ask',
            ...(signal ? { signal } : {}),
          })
        : resolveNonInteractiveDecision(evaluation);
    }
    if (decision !== 'allow') {
      throw new Error(`Permission ${decision} for ${action}: ${detail.slice(0, 160)}`);
    }
  }

  const startTool: HostToolDefinition = {
    name: 'process_start',
    description:
      'Start a Job using argv only. The default run lifetime stops it when the current Agent Run ends; choose session or host lifetime explicitly for longer-lived services.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['command', 'service'],
          description: 'Job kind; service is the default for long-running processes.',
        },
        lifetime: {
          type: 'string',
          enum: ['run', 'session', 'host'],
          description: 'Job lifetime; run is the safe default.',
        },
        command: { type: 'string', description: 'Executable to run (no shell).' },
        argv: { type: 'array', items: { type: 'string' }, description: 'Argument list.' },
        cwd: { type: 'string', description: 'Working directory inside a trusted project.' },
        label: { type: 'string', description: 'Optional short label for UI.' },
      },
      required: ['command', 'argv', 'cwd'],
    },
    async execute(argumentsObject, signal) {
      const command = readStringArgument(argumentsObject, 'command');
      const argv = readStringArrayArgument(argumentsObject, 'argv');
      const cwd = readStringArgument(argumentsObject, 'cwd') || projectPath || process.cwd();
      await gate('process:start', `${command} ${argv.join(' ')} @ ${cwd}`, signal);
      const defaults: Pick<BuildProcessToolsOptions, 'projectPath' | 'sessionId'> = {};
      if (projectPath) defaults.projectPath = projectPath;
      if (sessionId) defaults.sessionId = sessionId;
      const startInput = createStartJobInput(argumentsObject, defaults);
      const job = await jobController.start(startInput);
      return JSON.stringify(job, null, 2);
    },
  };

  const listTool: HostToolDefinition = {
    name: 'process_list',
    description: 'List native Job records owned by this Host.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Optional session owner filter.' },
        projectPath: { type: 'string', description: 'Optional project owner filter.' },
      },
    },
    async execute(argumentsObject) {
      const ownerSessionId =
        readOptionalStringArgument(argumentsObject, 'sessionId') ?? sessionId;
      const ownerProjectPath =
        readOptionalStringArgument(argumentsObject, 'projectPath') ?? projectPath;
      const jobs = await jobController.list({
        ...(ownerSessionId ? { ownerSessionId } : {}),
        ...(ownerProjectPath ? { ownerProjectPath } : {}),
      });
      return JSON.stringify({ jobs }, null, 2);
    },
  };

  const logsTool: HostToolDefinition = {
    name: 'process_logs',
    description: 'Read cursor-paginated logs for a native Job record.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Native Job id.' },
        afterCursor: { type: 'number', description: 'Exclusive cursor to continue from.' },
        maxBytes: { type: 'number', description: 'Maximum bytes to return.' },
      },
      required: ['jobId'],
    },
    async execute(argumentsObject) {
      const jobId = readStringArgument(argumentsObject, 'jobId');
      if (!jobId) {
        throw new Error('jobId is required');
      }
      const afterCursor = argumentsObject.afterCursor;
      const maxBytes = argumentsObject.maxBytes;
      const logs = await jobController.readLogs({
        jobId,
        ...(typeof afterCursor === 'number' ? { afterCursor } : {}),
        ...(typeof maxBytes === 'number' ? { maxBytes } : {}),
      });
      return JSON.stringify(logs, null, 2);
    },
  };

  const stopTool: HostToolDefinition = {
    name: 'process_stop',
    description: 'Stop a native Job record with graceful then forceful termination.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Native Job id.' },
      },
      required: ['jobId'],
    },
    async execute(argumentsObject, signal) {
      const jobId = readStringArgument(argumentsObject, 'jobId');
      if (!jobId) {
        throw new Error('jobId is required');
      }
      await gate('process:stop', jobId, signal);
      const result = await jobController.stop(jobId, 'user-stop');
      return JSON.stringify(result, null, 2);
    },
  };

  return [startTool, listTool, logsTool, stopTool];
}

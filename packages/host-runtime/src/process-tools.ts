/**
 * Host custom tools for JobController-backed process operations.
 *
 * The model-facing names remain `process_*` for product continuity, but every
 * input and output uses the native Job contracts. There is no legacy process
 * record projection between the tools and JobController.
 */
import type {
  HostToolExecutionContext,
  HostToolRegistration,
  JobController,
  JobKind,
  JobLifetime,
  StartJobInput,
  ToolResult,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

export type BuildProcessToolsOptions = {
  /** Single Host Job authority. */
  jobController: JobController;
  /** Default session id for session-scoped Jobs and list filters. */
  sessionId?: string;
  /** Default trusted project path for project-scoped Jobs and list filters. */
  projectPath?: string;
};

function jobFailure(error: unknown, runId: string, jobId?: string): ToolResult {
  const message = formatError(error);
  return {
    ok: false,
    code: 'job-failed',
    message,
    details: { runId, ...(jobId ? { jobId } : {}) },
    retryable: true,
  };
}

function readStringArgument(argumentsObject: Record<string, unknown>, name: string): string {
  return typeof argumentsObject[name] === 'string' ? (argumentsObject[name] as string) : '';
}

function readOptionalStringArgument(
  argumentsObject: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = argumentsObject[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArrayArgument(argumentsObject: Record<string, unknown>, name: string): string[] {
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

function createStartJobInput(
  argumentsObject: Record<string, unknown>,
  defaults: Pick<BuildProcessToolsOptions, 'projectPath' | 'sessionId'>,
  runId: string | undefined,
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
export function buildProcessTools(options: BuildProcessToolsOptions): HostToolRegistration[] {
  const { jobController, projectPath, sessionId } = options;

  const startTool: HostToolRegistration = {
    descriptor: {
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
    },
    family: 'process',
    permissionSpec: {
      action: 'process:start',
      risk: 'command',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'process' }),
    },
    async execute(argumentsObject, signal, context: HostToolExecutionContext) {
      const command = readStringArgument(argumentsObject, 'command');
      const argv = readStringArrayArgument(argumentsObject, 'argv');
      const cwd = readStringArgument(argumentsObject, 'cwd') || projectPath || process.cwd();
      const defaults: Pick<BuildProcessToolsOptions, 'projectPath' | 'sessionId'> = {};
      if (projectPath) defaults.projectPath = projectPath;
      if (sessionId) defaults.sessionId = sessionId;
      const startInput = createStartJobInput(argumentsObject, defaults, context.runId);
      let job: Awaited<ReturnType<JobController['start']>>;
      try {
        job = await jobController.start(startInput);
      } catch (error) {
        return jobFailure(error, context.runId);
      }
      return {
        ok: true,
        output: JSON.stringify(job, null, 2),
        details: { jobId: job.jobId, status: job.status, runId: context.runId },
      };
    },
  };

  const listTool: HostToolRegistration = {
    descriptor: {
      name: 'process_list',
      description: 'List native Job records owned by this Host.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Optional session owner filter.' },
          projectPath: { type: 'string', description: 'Optional project owner filter.' },
        },
      },
    },
    family: 'process',
    permissionSpec: {
      action: 'process:list',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'process' }),
      readOnly: true,
    },
    async execute(argumentsObject, _signal, context) {
      const ownerSessionId = readOptionalStringArgument(argumentsObject, 'sessionId') ?? sessionId;
      const ownerProjectPath =
        readOptionalStringArgument(argumentsObject, 'projectPath') ?? projectPath;
      let jobs: Awaited<ReturnType<JobController['list']>>;
      try {
        jobs = await jobController.list({
          ...(ownerSessionId ? { ownerSessionId } : {}),
          ...(ownerProjectPath ? { ownerProjectPath } : {}),
        });
      } catch (error) {
        return jobFailure(error, context.runId);
      }
      return {
        ok: true,
        output: JSON.stringify({ jobs }, null, 2),
        details: { count: jobs.length, runId: context.runId },
      };
    },
  };

  const logsTool: HostToolRegistration = {
    descriptor: {
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
    },
    family: 'process',
    permissionSpec: {
      action: 'process:logs',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'process' }),
      readOnly: true,
    },
    async execute(argumentsObject, _signal, context) {
      const jobId = readStringArgument(argumentsObject, 'jobId');
      if (!jobId) {
        return { ok: false, code: 'invalid-input', message: 'jobId is required' };
      }
      const afterCursor = argumentsObject.afterCursor;
      const maxBytes = argumentsObject.maxBytes;
      let logs: Awaited<ReturnType<JobController['readLogs']>>;
      try {
        logs = await jobController.readLogs({
          jobId,
          ...(typeof afterCursor === 'number' ? { afterCursor } : {}),
          ...(typeof maxBytes === 'number' ? { maxBytes } : {}),
        });
      } catch (error) {
        return jobFailure(error, context.runId, jobId);
      }
      return {
        ok: true,
        output: JSON.stringify(logs, null, 2),
        details: {
          jobId: logs.jobId,
          nextCursor: logs.nextCursor,
          hasMore: logs.hasMore,
          runId: context.runId,
        },
      };
    },
  };

  const stopTool: HostToolRegistration = {
    descriptor: {
      name: 'process_stop',
      description: 'Stop a native Job record with graceful then forceful termination.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Native Job id.' },
        },
        required: ['jobId'],
      },
    },
    family: 'process',
    permissionSpec: {
      action: 'process:stop',
      risk: 'command',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'process' }),
    },
    async execute(argumentsObject, signal, context) {
      const jobId = readStringArgument(argumentsObject, 'jobId');
      if (!jobId) {
        return { ok: false, code: 'invalid-input', message: 'jobId is required' };
      }
      let result: Awaited<ReturnType<JobController['stop']>>;
      try {
        result = await jobController.stop(jobId, 'user-stop');
      } catch (error) {
        return jobFailure(error, context.runId, jobId);
      }
      return {
        ok: true,
        output: JSON.stringify(result, null, 2),
        details: { jobId: result.job.jobId, status: result.job.status, runId: context.runId },
      };
    },
  };

  return [startTool, listTool, logsTool, stopTool];
}

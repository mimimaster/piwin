/**
 * Unit tests for the JobController-backed model process tools.
 *
 * The model-facing names stay `process_*`, but every input/output uses the
 * native Job contracts and only `JobController` is called.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  HostToolExecutionContext,
  JobCleanupResult,
  JobController,
  JobRecord,
  JobStopResult,
  ReadJobLogsResult,
  StartJobInput,
  WaitForJobInput,
  JobListFilter,
  ToolResult,
} from '@piwin/contracts';
import { buildProcessTools } from './process-tools.js';

function makeRecord(overrides?: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job-1',
    kind: 'command',
    lifetime: 'run',
    command: 'echo',
    argv: ['hello'],
    cwd: '/workspace',
    status: 'running',
    startedAt: '2025-01-01T00:00:00.000Z',
    latestLogCursor: 0,
    ...overrides,
  };
}

function createController(overrides?: Partial<JobController>): JobController & {
  startCalls: StartJobInput[];
} {
  const startCalls: StartJobInput[] = [];
  const controller: JobController & { startCalls: StartJobInput[] } = {
    startCalls,
    start: vi.fn(async (input: StartJobInput): Promise<JobRecord> => {
      startCalls.push(input);
      return makeRecord({
        jobId: `job-${startCalls.length}`,
        kind: input.kind,
        lifetime: input.lifetime,
        command: input.command,
        argv: [...input.argv],
        cwd: input.cwd,
      });
    }),
    list: vi.fn(async (): Promise<JobRecord[]> => []),
    get: vi.fn(async (): Promise<JobRecord | undefined> => undefined),
    readLogs: vi.fn(async (): Promise<ReadJobLogsResult> => ({
      jobId: '',
      chunks: [],
      nextCursor: 0,
      hasMore: false,
    })),
    wait: vi.fn(async (_input: WaitForJobInput): Promise<JobRecord> => makeRecord()),
    stop: vi.fn(async (): Promise<JobStopResult> => ({
      job: makeRecord({ status: 'cancelled' }),
      cleanup: {
        requestedJobIds: [],
        stoppedJobIds: [],
        alreadyTerminalJobIds: [],
        failedJobIds: [],
      },
    })),
    stopByRun: vi.fn(async (): Promise<JobCleanupResult> => ({
      requestedJobIds: [],
      stoppedJobIds: [],
      alreadyTerminalJobIds: [],
      failedJobIds: [],
    })),
    stopBySession: vi.fn(async (): Promise<JobCleanupResult> => ({
      requestedJobIds: [],
      stoppedJobIds: [],
      alreadyTerminalJobIds: [],
      failedJobIds: [],
    })),
    dispose: vi.fn(async (): Promise<JobCleanupResult> => ({
      requestedJobIds: [],
      stoppedJobIds: [],
      alreadyTerminalJobIds: [],
      failedJobIds: [],
    })),
    ...overrides,
  };
  return controller;
}

async function runStartTool(
  controller: JobController,
  argumentsObject: Record<string, unknown>,
  options: { sessionId?: string; projectPath?: string; runId?: string } = {},
): Promise<ToolResult> {
  const [startTool] = buildProcessTools({
    jobController: controller,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.projectPath ? { projectPath: options.projectPath } : {}),
  });
  if (startTool === undefined) {
    throw new Error('process_start tool was not registered');
  }
  const context: HostToolExecutionContext = {
    sessionId: options.sessionId ?? 'session-test',
    runtimeGenerationId: 'generation-test',
    runId: options.runId ?? 'run-test',
    toolName: startTool.descriptor.name,
  };
  return startTool.execute(argumentsObject, new AbortController().signal, context);
}

function outputOf(result: ToolResult): string {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  return result.output;
}

describe('process_start (JobController-backed)', () => {
  it('creates a run-owned Job from the Host execution context', async () => {
    const controller = createController();
    await runStartTool(
      controller,
      {
        command: 'echo',
        argv: ['hello'],
        cwd: '/workspace',
      },
      { sessionId: 'session-1', projectPath: '/workspace', runId: 'run-42' },
    );

    expect(controller.startCalls).toHaveLength(1);
    const input = controller.startCalls[0]!;
    expect(input.lifetime).toBe('run');
    expect(input.ownerRunId).toBe('run-42');
    expect(input.ownerSessionId).toBe('session-1');
    expect(input.ownerProjectPath).toBe('/workspace');
  });

  it('uses the context run id even when model arguments contain no hidden run field', async () => {
    const controller = createController();
    await runStartTool(
      controller,
      { command: 'echo', argv: ['x'], cwd: '/workspace' },
      { runId: 'run-from-context' },
    );
    expect(controller.startCalls[0]?.ownerRunId).toBe('run-from-context');
  });

  it('creates a session-owned Job for explicit session lifetime', async () => {
    const controller = createController();
    await runStartTool(
      controller,
      {
        command: 'serve',
        argv: [],
        cwd: '/workspace',
        lifetime: 'session',
      },
      { sessionId: 'session-1' },
    );

    const input = controller.startCalls[0]!;
    expect(input.lifetime).toBe('session');
    expect(input.ownerSessionId).toBe('session-1');
    expect(input.ownerRunId).toBeUndefined();
  });

  it('returns the native JobRecord JSON', async () => {
    const controller = createController();
    const output = outputOf(
      await runStartTool(
        controller,
        {
          command: 'echo',
          argv: ['hello'],
          cwd: '/workspace',
        },
        { sessionId: 'session-1', runId: 'run-1' },
      ),
    );
    const parsed = JSON.parse(output) as JobRecord;
    expect(parsed.jobId).toBe('job-1');
    expect(parsed.lifetime).toBe('run');
  });
});

describe('process_list / process_logs / process_stop', () => {
  it('process_list passes an owner filter to JobController', async () => {
    const controller = createController({
      list: vi.fn(async (filter?: JobListFilter): Promise<JobRecord[]> => {
        return filter?.ownerSessionId === 'session-1' ? [makeRecord()] : [];
      }),
    });
    const [, listTool] = buildProcessTools({
      jobController: controller,
      sessionId: 'session-1',
    });
    if (listTool === undefined) {
      throw new Error('process_list tool was not registered');
    }
    const output = outputOf(
      await listTool.execute({}, new AbortController().signal, {
        sessionId: 'session-1',
        runtimeGenerationId: 'generation-1',
        runId: 'run-1',
        toolName: listTool.descriptor.name,
      }),
    );
    expect(JSON.parse(output)).toMatchObject({ jobs: [{ jobId: 'job-1' }] });
  });

  it('process_logs passes jobId through to JobController.readLogs', async () => {
    const readLogs = vi.fn(async (): Promise<ReadJobLogsResult> => ({
      jobId: 'job-9',
      chunks: [],
      nextCursor: 0,
      hasMore: false,
    }));
    const controller = createController({ readLogs });
    const [, , logsTool] = buildProcessTools({
      jobController: controller,
    });
    if (logsTool === undefined) {
      throw new Error('process_logs tool was not registered');
    }
    const output = outputOf(
      await logsTool.execute({ jobId: 'job-9' }, new AbortController().signal, {
        sessionId: 'session-1',
        runtimeGenerationId: 'generation-1',
        runId: 'run-1',
        toolName: logsTool.descriptor.name,
      }),
    );
    expect(readLogs).toHaveBeenCalledWith({ jobId: 'job-9' });
    expect(JSON.parse(output)).toMatchObject({ jobId: 'job-9' });
  });

  it('process_stop stops the native Job with user-stop', async () => {
    const stop = vi.fn(async (): Promise<JobStopResult> => ({
      job: makeRecord({ status: 'cancelled', terminalReason: 'user-stop' }),
      cleanup: {
        requestedJobIds: ['job-1'],
        stoppedJobIds: ['job-1'],
        alreadyTerminalJobIds: [],
        failedJobIds: [],
      },
    }));
    const controller = createController({ stop });
    const tools = buildProcessTools({
      jobController: controller,
    });
    const stopTool = tools.find((tool) => tool.descriptor.name === 'process_stop');
    if (!stopTool) throw new Error('process_stop tool was not registered');
    const output = outputOf(
      await stopTool.execute({ jobId: 'job-1' }, new AbortController().signal, {
        sessionId: 'session-1',
        runtimeGenerationId: 'generation-1',
        runId: 'run-1',
        toolName: stopTool.descriptor.name,
      }),
    );
    expect(stop).toHaveBeenCalledWith('job-1', 'user-stop');
    expect(JSON.parse(output)).toMatchObject({ cleanup: { stoppedJobIds: ['job-1'] } });
  });
});

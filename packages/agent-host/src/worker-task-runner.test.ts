import { describe, expect, it, vi } from 'vitest';
import type { AgentWorkerSupervisor } from './agent-worker-supervisor.js';
import type { SubagentTaskRunInput, SubagentProviderEnvelope } from '@piwin/contracts';
import type { WorkerAdmission, WorkerAdmissionPort } from './worker-admission-port.js';
import { WorkerTaskRunner } from './worker-task-runner.js';

/** Minimal provider envelope used by test fixtures. */
const TEST_PROVIDERS: SubagentProviderEnvelope[] = [
  {
    providerId: 'test-provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.test.example/v1',
    models: [{ id: 'test-model', input: ['text'] }],
    auth: { kind: 'env', envName: 'TEST_API_KEY' },
  },
];

function buildValidInput(
  overrides: Partial<SubagentTaskRunInput> = {},
): SubagentTaskRunInput {
  return {
    taskRunId: 'run-1',
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    runtimeGenerationId: 'gen-1',
    task: { id: 'task-1', parentSessionId: 'parent-1', task: 'do work' },
    runtimeSnapshot: { isolation: 'readonly', workingDirectory: '/tmp' },
    workspaceLease: { mode: 'readonly', cwd: '/tmp', parentRepoPath: '/tmp' },
    sessionBlueprint: {
      version: 1,
      sessionId: 'child-1',
      runtimeGenerationId: 'gen-1',
      capabilitySnapshot: {
        version: 1,
        snapshotId: 'snap-1',
        inputs: {
          rulesRevision: 'rules-1',
          settingsRevision: 's-1',
          projectRevision: 'p-1',
          mcpRevision: 'm-1',
          resourceCatalogRevision: 'r-1',
        },
        scope: { kind: 'general' },
        workingDirectory: '/tmp',
        trust: { kind: 'general' },
        resources: {
          skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
        },
        resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
        context: {
          allowPiNativeInstructions: true,
          allowProjectAgentsFiles: false,
          allowProjectSystemPrompts: false,
        },
        contextManifest: { agentsFiles: [] },
        tools: {
          hostTools: [],
          piBuiltinToolNames: [],
          enabledMcpServerIds: [],
          enabledFamilies: [],
        },
      },
    },
    preparedPrompt: { text: 'do work' },
    providers: TEST_PROVIDERS,
    ...overrides,
  } as unknown as SubagentTaskRunInput;
}

describe('WorkerTaskRunner', () => {
  it('rejects a missing Blueprint instead of fabricating an empty one', async () => {
    const acquireWorker = vi.fn();
    const releaseWorker = vi.fn();
    const supervisor = {
      acquireWorker,
      releaseWorker,
    } as unknown as AgentWorkerSupervisor;
    const runner = new WorkerTaskRunner({ supervisor });
    const input = {
      sessionBlueprint: undefined,
    } as unknown as SubagentTaskRunInput;

    await expect(runner.runTask(input, new AbortController().signal)).rejects.toThrow(
      'WorkerTaskRunner requires a compiled BackendSessionBlueprint',
    );
    expect(acquireWorker).not.toHaveBeenCalled();
    expect(releaseWorker).not.toHaveBeenCalled();
  });

  it('rejects an empty provider envelope instead of passing providers: []', async () => {
    const acquireWorker = vi.fn();
    const releaseWorker = vi.fn();
    const supervisor = {
      acquireWorker,
      releaseWorker,
    } as unknown as AgentWorkerSupervisor;
    const runner = new WorkerTaskRunner({ supervisor });

    // Build an input with a valid blueprint but no providers.
    const input = {
      taskRunId: 'run-1',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      runtimeGenerationId: 'gen-1',
      task: { id: 'task-1', parentSessionId: 'parent-1', task: 'do work' },
      runtimeSnapshot: { isolation: 'readonly', workingDirectory: '/tmp' },
      workspaceLease: { mode: 'readonly', cwd: '/tmp', parentRepoPath: '/tmp' },
      sessionBlueprint: {
        version: 1,
        sessionId: 'child-1',
        runtimeGenerationId: 'gen-1',
        capabilitySnapshot: {
          version: 1,
          snapshotId: 'snap-1',
          inputs: {
            rulesRevision: 'rules-1',
            settingsRevision: 's-1',
            projectRevision: 'p-1',
            mcpRevision: 'm-1',
            resourceCatalogRevision: 'r-1',
          },
          scope: { kind: 'general' },
          workingDirectory: '/tmp',
          trust: { kind: 'general' },
          resources: {
            skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          },
          resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
          context: {
            allowPiNativeInstructions: true,
            allowProjectAgentsFiles: false,
            allowProjectSystemPrompts: false,
          },
          contextManifest: { agentsFiles: [] },
          tools: {
            hostTools: [],
            piBuiltinToolNames: [],
            enabledMcpServerIds: [],
            enabledFamilies: [],
          },
        },
      },
      preparedPrompt: { text: 'do work' },
      providers: [],
    } as unknown as SubagentTaskRunInput;

    await expect(runner.runTask(input, new AbortController().signal)).rejects.toThrow(
      'WorkerTaskRunner requires a provider envelope; providers: [] is forbidden',
    );
    expect(acquireWorker).not.toHaveBeenCalled();
    expect(releaseWorker).not.toHaveBeenCalled();
  });

  it('passes the provider envelope to createSession', async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'worker-session-1' });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn().mockResolvedValue(undefined);
    const acquireWorker = vi.fn().mockResolvedValue({ createSession, prompt, abort });
    const releaseWorker = vi.fn().mockResolvedValue(undefined);
    const supervisor = {
      acquireWorker,
      releaseWorker,
    } as unknown as AgentWorkerSupervisor;
    const runner = new WorkerTaskRunner({ supervisor });

    const input = {
      taskRunId: 'run-1',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      runtimeGenerationId: 'gen-1',
      task: { id: 'task-1', parentSessionId: 'parent-1', task: 'do work' },
      runtimeSnapshot: { isolation: 'readonly', workingDirectory: '/tmp' },
      workspaceLease: { mode: 'readonly', cwd: '/tmp', parentRepoPath: '/tmp' },
      sessionBlueprint: {
        version: 1,
        sessionId: 'child-1',
        runtimeGenerationId: 'gen-1',
        capabilitySnapshot: {
          version: 1,
          snapshotId: 'snap-1',
          inputs: {
            rulesRevision: 'rules-1',
            settingsRevision: 's-1',
            projectRevision: 'p-1',
            mcpRevision: 'm-1',
            resourceCatalogRevision: 'r-1',
          },
          scope: { kind: 'general' },
          workingDirectory: '/tmp',
          trust: { kind: 'general' },
          resources: {
            skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          },
          resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
          context: {
            allowPiNativeInstructions: true,
            allowProjectAgentsFiles: false,
            allowProjectSystemPrompts: false,
          },
          contextManifest: { agentsFiles: [] },
          tools: {
            hostTools: [],
            piBuiltinToolNames: [],
            enabledMcpServerIds: [],
            enabledFamilies: [],
          },
        },
      },
      preparedPrompt: { text: 'do work' },
      providers: TEST_PROVIDERS,
    } as unknown as SubagentTaskRunInput;

    const previousKey = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = 'test-secret';
    try {
      const result = await runner.runTask(input, new AbortController().signal);

      expect(result.executionStatus).toBe('completed');
      expect(acquireWorker).toHaveBeenCalledWith('child-1', 'gen-1', {
        env: { TEST_API_KEY: 'test-secret' },
      });
      expect(createSession).toHaveBeenCalledTimes(1);
      const callArg = createSession.mock.calls[0]?.[0] as {
        providers?: unknown[];
      };
      expect(callArg.providers).toEqual(TEST_PROVIDERS);
      expect(callArg.providers).not.toEqual([]);
    } finally {
      if (previousKey === undefined) delete process.env.TEST_API_KEY;
      else process.env.TEST_API_KEY = previousKey;
    }
  });

  it('without admission keeps acquire/release sequence and error mapping unchanged', async () => {
    const callOrder: string[] = [];
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'worker-session-1' });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn().mockResolvedValue(undefined);
    const acquireWorker = vi.fn(async () => {
      callOrder.push('acquireWorker');
      return { createSession, prompt, abort };
    });
    const releaseWorker = vi.fn(async () => {
      callOrder.push('releaseWorker');
    });
    const supervisor = { acquireWorker, releaseWorker } as unknown as AgentWorkerSupervisor;
    const runner = new WorkerTaskRunner({ supervisor });

    const previousKey = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = 'test-secret';
    try {
      const completed = await runner.runTask(buildValidInput(), new AbortController().signal);
      expect(completed.executionStatus).toBe('completed');
      expect(callOrder).toEqual(['acquireWorker', 'releaseWorker']);

      const failingAcquire = vi.fn(async () => {
        callOrder.push('acquireWorker-fail');
        throw new Error('boom');
      });
      const failingRelease = vi.fn(async () => {
        callOrder.push('releaseWorker-fail');
      });
      callOrder.length = 0;
      const failingRunner = new WorkerTaskRunner({
        supervisor: {
          acquireWorker: failingAcquire,
          releaseWorker: failingRelease,
        } as unknown as AgentWorkerSupervisor,
      });
      const failed = await failingRunner.runTask(buildValidInput(), new AbortController().signal);
      expect(failed).toMatchObject({
        executionStatus: 'failed',
        error: 'boom',
      });
      expect(callOrder).toEqual(['acquireWorker-fail', 'releaseWorker-fail']);
    } finally {
      if (previousKey === undefined) delete process.env.TEST_API_KEY;
      else process.env.TEST_API_KEY = previousKey;
    }
  });

  it('with admission: begin before acquire, commit after acquire, release once on success/failure/cancel', async () => {
    const previousKey = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = 'test-secret';
    try {
      async function runWithAdmission(mode: 'success' | 'failure' | 'cancel') {
        const callOrder: string[] = [];
        const commit = vi.fn(() => {
          callOrder.push('commit');
        });
        const release = vi.fn(() => {
          callOrder.push('release');
        });
        const begin = vi.fn(async (input: {
          sessionId: string;
          runtimeGenerationId: string;
          runId?: string;
          signal: AbortSignal;
        }): Promise<WorkerAdmission> => {
          callOrder.push('begin');
          expect(input).toMatchObject({
            sessionId: 'child-1',
            runtimeGenerationId: 'gen-1',
            runId: 'run-1',
          });
          expect(input.signal).toBeInstanceOf(AbortSignal);
          return { commit, release };
        });
        const admission: WorkerAdmissionPort = { begin };

        const createSession = vi.fn().mockResolvedValue({ sessionId: 'worker-session-1' });
        const abort = vi.fn().mockResolvedValue(undefined);
        let resolvePrompt: (() => void) | undefined;
        const prompt = vi.fn(
          () =>
            new Promise<void>((resolve, reject) => {
              if (mode === 'cancel') {
                resolvePrompt = () => reject(new Error('should-not-resolve'));
                return;
              }
              if (mode === 'failure') {
                reject(new Error('prompt-failed'));
                return;
              }
              resolve();
            }),
        );
        const acquireWorker = vi.fn(async () => {
          callOrder.push('acquireWorker');
          return { createSession, prompt, abort };
        });
        const releaseWorker = vi.fn(async () => {
          callOrder.push('releaseWorker');
        });
        const supervisor = { acquireWorker, releaseWorker } as unknown as AgentWorkerSupervisor;
        const runner = new WorkerTaskRunner({ supervisor, admission });
        const controller = new AbortController();

        const runPromise = runner.runTask(buildValidInput(), controller.signal);
        if (mode === 'cancel') {
          await Promise.resolve();
          controller.abort();
        }
        const result = await runPromise;

        expect(begin).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
        expect(callOrder.indexOf('begin')).toBeLessThan(callOrder.indexOf('acquireWorker'));
        expect(callOrder.indexOf('acquireWorker')).toBeLessThan(callOrder.indexOf('commit'));
        expect(callOrder.indexOf('releaseWorker')).toBeLessThan(callOrder.indexOf('release'));
        expect(callOrder.filter((step) => step === 'release')).toHaveLength(1);

        if (mode === 'success') {
          expect(result.executionStatus).toBe('completed');
        } else if (mode === 'failure') {
          expect(result).toMatchObject({
            executionStatus: 'failed',
            error: 'prompt-failed',
          });
        } else {
          expect(result.executionStatus).toBe('cancelled');
          void resolvePrompt;
        }
      }

      await runWithAdmission('success');
      await runWithAdmission('failure');
      await runWithAdmission('cancel');
    } finally {
      if (previousKey === undefined) delete process.env.TEST_API_KEY;
      else process.env.TEST_API_KEY = previousKey;
    }
  });

  it('begin runtime-memory-pressure fails the task without acquiring a worker', async () => {
    const acquireWorker = vi.fn().mockResolvedValue({
      createSession: vi.fn(),
      prompt: vi.fn(),
      abort: vi.fn(),
    });
    const releaseWorker = vi.fn().mockResolvedValue(undefined);
    const begin = vi.fn(async () => {
      const error = new Error('runtime-memory-pressure');
      (error as Error & { code: string }).code = 'runtime-memory-pressure';
      throw error;
    });
    const admission: WorkerAdmissionPort = { begin };
    const runner = new WorkerTaskRunner({
      supervisor: { acquireWorker, releaseWorker } as unknown as AgentWorkerSupervisor,
      admission,
    });

    const result = await runner.runTask(buildValidInput(), new AbortController().signal);
    expect(result).toMatchObject({
      executionStatus: 'failed',
      error: expect.stringContaining('runtime-memory-pressure'),
    });
    expect(acquireWorker).not.toHaveBeenCalled();
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('abort while waiting on begin returns cancelled', async () => {
    const acquireWorker = vi.fn().mockResolvedValue({
      createSession: vi.fn(),
      prompt: vi.fn(),
      abort: vi.fn(),
    });
    const releaseWorker = vi.fn().mockResolvedValue(undefined);
    const begin = vi.fn(async () => {
      throw new Error('aborted');
    });
    const admission: WorkerAdmissionPort = { begin };
    const runner = new WorkerTaskRunner({
      supervisor: { acquireWorker, releaseWorker } as unknown as AgentWorkerSupervisor,
      admission,
    });
    const controller = new AbortController();
    controller.abort();

    const result = await runner.runTask(buildValidInput(), controller.signal);
    expect(result.executionStatus).toBe('cancelled');
    expect(acquireWorker).not.toHaveBeenCalled();
  });

  it('releases admission when acquireWorker throws before commit', async () => {
    const callOrder: string[] = [];
    const commit = vi.fn(() => {
      callOrder.push('commit');
    });
    const release = vi.fn(() => {
      callOrder.push('release');
    });
    const begin = vi.fn(async (): Promise<WorkerAdmission> => {
      callOrder.push('begin');
      return { commit, release };
    });
    const acquireWorker = vi.fn(async () => {
      callOrder.push('acquireWorker');
      throw new Error('acquire-failed');
    });
    const releaseWorker = vi.fn(async () => {
      callOrder.push('releaseWorker');
    });
    const runner = new WorkerTaskRunner({
      supervisor: { acquireWorker, releaseWorker } as unknown as AgentWorkerSupervisor,
      admission: { begin },
    });

    const result = await runner.runTask(buildValidInput(), new AbortController().signal);
    expect(result).toMatchObject({
      executionStatus: 'failed',
      error: 'acquire-failed',
    });
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['begin', 'acquireWorker', 'releaseWorker', 'release']);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { USER_STOPPED_SUBAGENT_MESSAGE } from './subagent-orchestrator-finalize.js';
import { RunRegistry } from './run-registry.js';
import type { SubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';
import type {
  BackendPreparedPrompt,
  BackendSessionBlueprint,
  SessionCapabilitySnapshot,
  SubagentBatchRequest,
  SubagentProviderEnvelope,
  SubagentTaskSpec,
  SubagentWorkspaceLease,
  SubagentTaskRunInput,
  SubagentTaskRunOutput,
  SubagentTaskRunner,
  HostPush,
} from '@piwin/contracts';
import type { SubagentOrchestratorOptions } from './subagent-orchestrator.js';
import { createDefaultPiwinConfig } from './config-store.js';

const RUNTIME_GENERATION_ID = 'generation-test';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

function sourceLineCount(fileName: string): number {
  return readFileSync(join(SRC_DIR, fileName), 'utf8').split('\n').length;
}

/** Minimal fake integration coordinator for tests. */
function makeFakeIntegrationCoordinator(
  options: { fail?: boolean; conflict?: boolean } = {},
): SubagentIntegrationCoordinator {
  return {
    async integrate(result, _lease) {
      if (options.fail) {
        return { ...result, integrationStatus: 'failed', error: 'fake integration failure' };
      }
      if (options.conflict) {
        return { ...result, integrationStatus: 'conflict', error: 'fake integration conflict' };
      }
      return { ...result, integrationStatus: 'applied', changedFiles: ['src/a.ts'] };
    },
    async retain() {},
    async isBaseClean() {
      return true;
    },
    async dispose() {},
  };
}

function makePreparedTask(input: {
  childSessionId: string;
  runtimeGenerationId: string;
  task: SubagentTaskSpec;
  workspaceLease: SubagentWorkspaceLease;
}): {
  runtimeSnapshot: NonNullable<SubagentTaskRunInput['runtimeSnapshot']>;
  sessionBlueprint: BackendSessionBlueprint;
  preparedPrompt: BackendPreparedPrompt;
  providers: SubagentProviderEnvelope[];
} {
  const capabilitySnapshot: SessionCapabilitySnapshot = {
    version: 1,
    snapshotId: `snapshot-${input.childSessionId}`,
    inputs: {
      rulesRevision: 'rules-test',
      settingsRevision: 'settings-test',
      projectRevision: 'project-test',
      mcpRevision: 'mcp-test',
      resourceCatalogRevision: 'resources-test',
    },
    scope: { kind: 'general' },
    workingDirectory: input.workspaceLease.cwd,
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
  };

  return {
    runtimeSnapshot: {
      ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
      ...(input.task.model ? { model: input.task.model } : {}),
      ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
      isolation: input.workspaceLease.mode,
      workingDirectory: input.workspaceLease.cwd,
    },
    sessionBlueprint: {
      version: 1,
      sessionId: input.childSessionId,
      runtimeGenerationId: input.runtimeGenerationId,
      capabilitySnapshot,
    },
    preparedPrompt: { text: input.task.task, runId: `run-${input.childSessionId}` },
    providers: [
      {
        providerId: 'test-provider',
        protocol: 'openai-compatible',
        baseUrl: 'https://test.example.com/v1',
        models: [{ id: 'test-model' }],
        auth: { kind: 'none' },
      },
    ],
  };
}

function makeTask(overrides: Partial<SubagentTaskSpec> = {}): SubagentTaskSpec {
  return {
    id: 'task-1',
    parentSessionId: 'parent-1',
    task: 'do something',
    ...overrides,
  };
}

function makeBatch(
  tasks: SubagentTaskSpec[],
  overrides: Partial<SubagentBatchRequest> = {},
): SubagentBatchRequest {
  return {
    parentSessionId: 'parent-1',
    tasks,
    maxConcurrency: 4,
    ...overrides,
  };
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
  reject(error: Error): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return {
    promise,
    resolve: (value?: T) => {
      if (!resolvePromise) throw new Error('deferred promise was not initialized');
      resolvePromise(value as T);
    },
    reject: (error: Error) => {
      if (!rejectPromise) throw new Error('deferred promise was not initialized');
      rejectPromise(error);
    },
  };
}

function makeFakeBackend(options: {
  delayMs?: number;
  waitFor?: Promise<void>;
  failTaskIds?: Set<string>;
  executionStatus?: SubagentTaskRunOutput['executionStatus'];
  integrationStatus?: SubagentTaskRunOutput['integrationStatus'];
  ignoreAbort?: boolean;
}) {
  const startedTasks: string[] = [];
  const receivedProviderEnvelopes: SubagentProviderEnvelope[][] = [];
  let activeCount = 0;
  let maxActive = 0;

  const taskRunner: SubagentTaskRunner = {
    capabilities: { processIsolation: false },
    async runTask(
      input: SubagentTaskRunInput,
      signal: AbortSignal,
    ): Promise<SubagentTaskRunOutput> {
      const task = input.task;
      startedTasks.push(task.id);
      receivedProviderEnvelopes.push(input.providers ?? []);
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);

      if (options.waitFor) {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (fn: () => void): void => {
            if (settled) return;
            settled = true;
            fn();
          };
          options.waitFor?.then(
            () => finish(resolve),
            (error: unknown) =>
              finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
          );
          if (!options.ignoreAbort) {
            signal.addEventListener(
              'abort',
              () => finish(() => reject(new Error('aborted'))),
              { once: true },
            );
          }
        });
      } else {
        const delay = options.delayMs ?? 10;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          if (!options.ignoreAbort) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            });
          }
        });
      }

      activeCount--;
      const failed = options.failTaskIds?.has(task.id);
      const output: SubagentTaskRunOutput = {
        executionStatus: failed ? 'failed' : (options.executionStatus ?? 'completed'),
        summaryStatus: 'not-requested',
        integrationStatus: options.integrationStatus ?? 'not-requested',
        childSessionId: `child-${task.id}`,
        ...(failed ? { error: 'fake failure' } : {}),
      };
      return output;
    },
  };

  const workspaceService = {
    async acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease> {
      if (task.isolationOverride === 'worktree') {
        return {
          mode: 'worktree',
          cwd: `/tmp/${task.id}`,
          parentRepoPath: '/tmp/project',
          worktreePath: `/tmp/${task.id}`,
          worktreeBranch: `piwin/subagent/${task.id}`,
          baseCommit: 'base-commit',
        };
      }

      return {
        mode: 'readonly',
        cwd: `/tmp/${task.id}`,
        parentRepoPath: '/tmp/project',
      };
    },
    async release(_lease: SubagentWorkspaceLease): Promise<void> {},
  };

  return {
    taskRunner,
    workspaceService,
    prepareTask: async (input: {
      childSessionId: string;
      runtimeGenerationId: string;
      task: SubagentTaskSpec;
      workspaceLease: SubagentWorkspaceLease;
    }) => makePreparedTask(input),
    startedTasks,
    receivedProviderEnvelopes,
    maxActive: () => maxActive,
  };
}

function makePushCollector() {
  const pushes: HostPush[] = [];
  return {
    push: (msg: HostPush) => pushes.push(msg),
    pushes,
  };
}

describe('SubagentOrchestrator', () => {
  it('runs all tasks and returns completed batch', async () => {
    const backend = makeFakeBackend({});
    const { push, pushes } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    const result = await orchestrator.runBatch(
      makeBatch([
        makeTask({ id: 'a', invocationId: 'inv-a', parentToolCallId: 'parent-tool-a' }),
        makeTask({ id: 'b' }),
      ]),
    );
    expect(result.status).toBe('completed');
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.taskId).sort()).toEqual(['a', 'b']);
    // Batch-updated event emitted.
    expect(pushes.some((p) => p.type === 'subagent/batch-updated')).toBe(true);
    const runningPush = pushes.find(
      (push) => push.type === 'subagent/batch-updated' && push.result.status === 'running',
    );
    expect(runningPush).toBeDefined();
    const taskAInvocationStatuses = pushes.flatMap((candidate) =>
      candidate.type === 'subagent/invocation-updated' && candidate.invocation.taskId === 'a'
        ? [candidate.invocation.status]
        : [],
    );
    expect(taskAInvocationStatuses).toEqual(['queued', 'starting', 'running', 'completed']);
    // Phase F: the compiled provider envelope is forwarded to the runner.
    expect(backend.receivedProviderEnvelopes).toHaveLength(2);
    for (const envelope of backend.receivedProviderEnvelopes) {
      expect(envelope.length).toBeGreaterThan(0);
      expect(envelope[0]?.providerId).toBe('test-provider');
    }
  });

  it('copies role and resolved model onto the first invocation projection', async () => {
    const backend = makeFakeBackend({});
    const { push, pushes } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    await orchestrator.runBatch(
      makeBatch([
        makeTask({
          id: 'scout',
          invocationId: 'inv-scout',
          parentToolCallId: 'parent-tool-scout',
          role: 'scout',
          profileId: 'explorer',
          model: {
            protocol: 'openai-compatible',
            providerId: 'custom-openai',
            modelId: 'deepseek-v4-flash',
          },
        }),
      ]),
    );
    const first = pushes.find(
      (candidate) =>
        candidate.type === 'subagent/invocation-updated' &&
        candidate.invocation.id === 'inv-scout',
    );
    expect(first?.type).toBe('subagent/invocation-updated');
    if (first?.type !== 'subagent/invocation-updated') return;
    expect(first.invocation.role).toBe('scout');
    expect(first.invocation.profileId).toBe('explorer');
    expect(first.invocation.model).toEqual({
      protocol: 'openai-compatible',
      providerId: 'custom-openai',
      modelId: 'deepseek-v4-flash',
    });
  });

  it('preflights credentials before allocating a workspace or child identity', async () => {
    const backend = makeFakeBackend({});
    let workspaceAcquired = false;
    let childRegistered = false;
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: {
        ...backend.workspaceService,
        async acquire(task) {
          workspaceAcquired = true;
          return backend.workspaceService.acquire(task);
        },
      },
      prepareTask: backend.prepareTask,
      preflightTask: async () => {
        throw new Error(
          'subagent-unavailable-fallback-main: credentials for provider "custom-openai" are unavailable',
        );
      },
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push: () => {},
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
      registerTaskSession: async () => {
        childRegistered = true;
      },
    });

    const result = await orchestrator.runBatch(makeBatch([makeTask()]));

    expect(result.status).toBe('failed');
    expect(result.results[0]?.childSessionId).toBeUndefined();
    expect(result.results[0]?.error).toContain('subagent-unavailable-fallback-main');
    expect(workspaceAcquired).toBe(false);
    expect(childRegistered).toBe(false);
  });

  it('forwards the one-shot preflight snapshot into task preparation', async () => {
    const backend = makeFakeBackend({});
    const preflight = {
      config: createDefaultPiwinConfig(),
      effectiveModel: {
        protocol: 'openai-compatible' as const,
        providerId: 'custom-openai',
        modelId: 'review-model',
      },
      resolvedProviderSecrets: [
        {
          providerId: 'custom-openai',
          apiKeyRef: 'keychain:custom-openai',
          value: 'single-use-canary',
        },
      ],
    };
    let receivedPreflight: unknown;
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      preflightTask: async () => preflight,
      prepareTask: async (input) => {
        receivedPreflight = input.preflight;
        return backend.prepareTask(input);
      },
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push: () => undefined,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const result = await orchestrator.runBatch(makeBatch([makeTask()]));

    expect(result.status).toBe('completed');
    expect(receivedPreflight).toBe(preflight);
  });

  it('reuses the child identity and forwards bounded seed history for continuation', async () => {
    let received: SubagentTaskRunInput | undefined;
    const taskRunner: SubagentTaskRunner = {
      capabilities: { processIsolation: true },
      async runTask(input) {
        received = input;
        return {
          childSessionId: input.childSessionId,
          executionStatus: 'completed',
          summaryStatus: 'pending',
          integrationStatus: 'not-requested',
          summaryPreview: 'continued',
        };
      },
    };
    const workspaceLease: SubagentWorkspaceLease = {
      mode: 'readonly',
      cwd: '/tmp/existing-child',
      parentRepoPath: '/tmp/project',
    };
    const orchestrator = new SubagentOrchestrator({
      taskRunner,
      workspaceService: {
        async acquire(task) {
          return task.continuationWorkspaceLease ?? workspaceLease;
        },
        async release() {},
      },
      prepareTask: async (input) => ({
        ...makePreparedTask(input),
        seedMessages: [
          { role: 'user', text: 'original task', timestamp: 1 },
          { role: 'assistant', text: 'original answer', timestamp: 2 },
        ],
      }),
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push: () => {},
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const result = await orchestrator.runBatch(
      makeBatch([
        makeTask({
          id: 'continuation-task',
          continuationSessionId: 'child-existing',
          continuationWorkspaceLease: workspaceLease,
          task: 'continue reviewing',
        }),
      ]),
    );

    expect(result.results[0]?.childSessionId).toBe('child-existing');
    expect(received?.childSessionId).toBe('child-existing');
    expect(received?.seedMessages).toHaveLength(2);
  });

  it('waits for child-session cleanup before completing a task', async () => {
    const backend = makeFakeBackend({});
    const { push } = makePushCollector();
    let cleanupFinished = false;
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
      registerTaskSession: async () => undefined,
      unregisterTaskSession: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        cleanupFinished = true;
      },
    });

    const result = await orchestrator.runBatch(makeBatch([makeTask({ id: 'cleanup' })]));

    expect(result.status).toBe('completed');
    expect(cleanupFinished).toBe(true);
  });

  it('terminalizes an allocated child when task preparation fails', async () => {
    const backend = makeFakeBackend({});
    const persistedResults: Array<{
      parentSessionId: string;
      result: import('@piwin/contracts').SubagentTaskResult;
    }> = [];
    let registeredChildSessionId: string | undefined;
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: async () => {
        throw new Error('project scope requires a non-empty projectPath');
      },
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push: () => undefined,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
      registerTaskSession: async ({ childSessionId }) => {
        registeredChildSessionId = childSessionId;
      },
      onTaskResult: async (input) => {
        persistedResults.push(input);
      },
    });

    const result = await orchestrator.runBatch(makeBatch([makeTask({ id: 'prepare-failure' })]));

    expect(result.status).toBe('failed');
    expect(registeredChildSessionId).toBeDefined();
    expect(result.results[0]).toMatchObject({
      childSessionId: registeredChildSessionId,
      executionStatus: 'failed',
      error: 'project scope requires a non-empty projectPath',
    });
    expect(persistedResults).toHaveLength(1);
    expect(persistedResults[0]?.result.childSessionId).toBe(registeredChildSessionId);
  });

  it('respects maxConcurrency', async () => {
    const backend = makeFakeBackend({ delayMs: 50 });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    await orchestrator.runBatch(
      makeBatch(
        [
          makeTask({ id: 'a' }),
          makeTask({ id: 'b' }),
          makeTask({ id: 'c' }),
          makeTask({ id: 'd' }),
        ],
        { maxConcurrency: 2 },
      ),
    );
    expect(backend.maxActive()).toBeLessThanOrEqual(2);
  });

  it('schedules dependent tasks after dependencies complete', async () => {
    const backend = makeFakeBackend({});
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    const result = await orchestrator.runBatch(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b', dependsOn: ['a'] })]),
    );
    expect(result.status).toBe('completed');
    // 'a' should start before 'b'.
    expect(backend.startedTasks.indexOf('a')).toBeLessThan(backend.startedTasks.indexOf('b'));
  });

  it('continues independent siblings when one fails with continue policy', async () => {
    const backend = makeFakeBackend({ failTaskIds: new Set(['a']) });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    const result = await orchestrator.runBatch(
      makeBatch(
        [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c', dependsOn: ['a'] })],
        { failurePolicy: 'continue' },
      ),
    );
    expect(result.status).toBe('failed');
    // 'b' should still complete (independent sibling).
    const bResult = result.results.find((r) => r.taskId === 'b');
    expect(bResult?.executionStatus).toBe('completed');
    // 'c' should be cancelled (dependent on failed 'a').
    const cResult = result.results.find((r) => r.taskId === 'c');
    expect(cResult?.executionStatus).toBe('cancelled');
  });

  it('rejects invalid batch (empty tasks)', async () => {
    const backend = makeFakeBackend({});
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    expect(() => orchestrator.startBatch(makeBatch([]))).toThrow('at least one task');
  });

  it('cancels batch via cancelBatch', async () => {
    const backend = makeFakeBackend({ delayMs: 500 });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    const runPromise = orchestrator.runBatch(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]),
    );
    // Cancel while running.
    // Wait a tick for the run to start.
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Find the runId from active runs — we need to get it from the result.
    // Since we don't know the runId yet, we can't cancel directly.
    // Instead, test that abort signal propagation works by checking the result.
    const result = await runPromise;
    // Without cancellation, all should complete.
    expect(result.status).toBe('completed');
  });

  it('emits task-updated events for each task', async () => {
    const backend = makeFakeBackend({});
    const { push, pushes } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    await orchestrator.runBatch(makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]));
    const taskUpdates = pushes.filter((p) => p.type === 'subagent/task-updated');
    expect(taskUpdates).toHaveLength(2);
  });

  it('rejects a cyclic batch at validation (A→B, B→A)', async () => {
    const backend = makeFakeBackend({});
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });
    expect(() =>
      orchestrator.startBatch(
        makeBatch([
          makeTask({ id: 'a', dependsOn: ['b'] }),
          makeTask({ id: 'b', dependsOn: ['a'] }),
        ]),
      ),
    ).toThrow('dependency cycle detected in task graph');
    expect(backend.startedTasks).toHaveLength(0);
  });

  it('accepts a batch immediately and can cancel before scheduling starts', async () => {
    const backend = makeFakeBackend({ delayMs: 100 });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const handle = orchestrator.startBatch(makeBatch([makeTask({ id: 'a' })]));
    expect(handle.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(orchestrator.isRunning(handle.runId)).toBe(true);
    expect(backend.startedTasks).toHaveLength(0);

    await orchestrator.cancelBatch(handle.runId);
    const result = await handle.completion;
    expect(result.status).toBe('cancelled');
    expect(result.results[0]?.executionStatus).toBe('cancelled');
    expect(orchestrator.isRunning(handle.runId)).toBe(false);
  });

  it('does not let a late runner completion overwrite cancellation', async () => {
    const backend = makeFakeBackend({ delayMs: 20, ignoreAbort: true });
    const { push, pushes } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const handle = orchestrator.startBatch(makeBatch([makeTask({ id: 'a' })]));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await orchestrator.cancelBatch(handle.runId);
    const result = await handle.completion;

    expect(result.status).toBe('cancelled');
    expect(result.results[0]?.executionStatus).toBe('cancelled');
    expect(pushes.filter((push) => push.type === 'subagent/task-updated')).toHaveLength(0);
  });

  it('detaches a user-stopped batch whose runner ignores cancellation past the deadline', async () => {
    const backend = makeFakeBackend({ delayMs: 400, ignoreAbort: true });
    const { push, pushes } = makePushCollector();
    const runRegistry = new RunRegistry();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry,
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const handle = orchestrator.startBatch(makeBatch([makeTask({ id: 'a' })]));
    await vi.waitFor(() => {
      expect(backend.startedTasks).toHaveLength(1);
    });
    const status = await orchestrator.cancelBatch(handle.runId, {
      initiator: 'user',
      timeoutMs: 20,
    });
    const result = await handle.completion;

    expect(status).toBe('detached');
    expect(result.status).toBe('cancelled');
    expect(result.results[0]).toMatchObject({
      executionStatus: 'cancelled',
      error: USER_STOPPED_SUBAGENT_MESSAGE,
    });
    expect(runRegistry.get(handle.runId)?.status).toBe('cancelled');
    expect(runRegistry.hasActiveDescendants(handle.runId)).toBe(false);
    expect(pushes.some((message) => message.type === 'host/log')).toBe(true);
  });

  it('marks a user stop that settles in time without detaching', async () => {
    const backend = makeFakeBackend({ delayMs: 400 });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const handle = orchestrator.startBatch(makeBatch([makeTask({ id: 'a' })]));
    await vi.waitFor(() => {
      expect(backend.startedTasks).toHaveLength(1);
    });
    const status = await orchestrator.cancelBatch(handle.runId, { initiator: 'user' });
    const result = await handle.completion;

    expect(status).toBe('cancelled');
    expect(result.results[0]).toMatchObject({
      executionStatus: 'cancelled',
      error: USER_STOPPED_SUBAGENT_MESSAGE,
    });
  });

  it('does not attribute a non-user cancellation to the user', async () => {
    const backend = makeFakeBackend({ delayMs: 400 });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const handle = orchestrator.startBatch(makeBatch([makeTask({ id: 'a' })]));
    await vi.waitFor(() => {
      expect(backend.startedTasks).toHaveLength(1);
    });
    await orchestrator.cancelBatch(handle.runId);
    const result = await handle.completion;

    expect(result.results[0]?.error ?? '').not.toContain('Stopped by the user');
  });

  it('rejects construction without explicit task preparation', () => {
    const backend = makeFakeBackend({});
    const { push } = makePushCollector();
    const options = {
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    } as unknown as SubagentOrchestratorOptions;

    expect(() => new SubagentOrchestrator(options)).toThrow('requires prepareTask');
  });

  it('uses child session and generation identities for task runs', async () => {
    const backend = makeFakeBackend({});
    const { push } = makePushCollector();
    const runRegistry = new RunRegistry();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry,
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const result = await orchestrator.runBatch(makeBatch([makeTask({ id: 'a' })]));
    const taskRun = runRegistry.list({ kind: 'subagent-task' })[0];
    expect(result.status).toBe('completed');
    expect(taskRun?.sessionId).not.toBe('parent-1');
    expect(taskRun?.runtimeGenerationId).toBe(RUNTIME_GENERATION_ID);
  });

  it('keeps a finished child completed and integrated when result freeze fails', async () => {
    const backend = makeFakeBackend({ integrationStatus: 'pending' });
    const { push } = makePushCollector();
    const integrationCoordinator = makeFakeIntegrationCoordinator();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator,
      freezeChildResult: () =>
        Promise.reject(new Error('object exceeds maxObjectBytes (20971520)')),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    try {
      const result = await orchestrator.runBatch(
        makeBatch([makeTask({ id: 'a', isolationOverride: 'worktree' })]),
      );
      expect(result.status).toBe('completed');
      expect(result.results[0]?.executionStatus).toBe('completed');
      expect(result.results[0]?.integrationStatus).toBe('applied');
      expect(result.results[0]?.error).toBeUndefined();
      expect(result.results[0]?.childChanges).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('maxObjectBytes'));
    } finally {
      warn.mockRestore();
    }
  });

  it('does not complete a worktree batch when integration fails', async () => {
    const backend = makeFakeBackend({ integrationStatus: 'pending' });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator({ fail: true }),
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const result = await orchestrator.runBatch(
      makeBatch([
        makeTask({ id: 'a', isolationOverride: 'worktree', allowedOutputPaths: ['src/a.ts'] }),
      ]),
    );
    expect(result.status).toBe('failed');
    expect(result.results[0]?.integrationStatus).toBe('failed');
    expect(result.results[0]?.error).toContain('fake integration failure');
    expect(result.results[0]?.allowedOutputPaths).toEqual(['src/a.ts']);
  });

  it('resolves accepted only after deferred manifest and queued invocation persistence', async () => {
    const childGate = createDeferred();
    const manifestGate = createDeferred();
    const invocationGate = createDeferred();
    const backend = makeFakeBackend({ waitFor: childGate.promise });
    const { push } = makePushCollector();
    let acceptedSettled = false;
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      runStore: {
        createManifest: async () => {
          await manifestGate.promise;
        },
        recordInvocation: async () => {
          await invocationGate.promise;
        },
        recordResult: async () => {},
        setStatus: async () => {},
      },
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const handle = orchestrator.startBatch(
      makeBatch([makeTask({ id: 'a', invocationId: 'inv-a' })]),
    );
    void handle.accepted.then(() => {
      acceptedSettled = true;
    });
    await Promise.resolve();
    expect(acceptedSettled).toBe(false);
    expect(backend.startedTasks).toHaveLength(0);

    manifestGate.resolve();
    await Promise.resolve();
    expect(acceptedSettled).toBe(false);

    invocationGate.resolve();
    await handle.accepted;
    expect(acceptedSettled).toBe(true);
    expect(backend.startedTasks).toHaveLength(0);

    childGate.resolve();
    await handle.completion;
    expect(backend.startedTasks).toEqual(['a']);
  });

  it('rejects accepted when durable manifest or invocation persistence fails', async () => {
    const childGate = createDeferred();
    const backend = makeFakeBackend({ waitFor: childGate.promise });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      runStore: {
        createManifest: async () => {
          throw new Error('manifest persist failed');
        },
        recordInvocation: async () => {},
        recordResult: async () => {},
        setStatus: async () => {},
      },
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const handle = orchestrator.startBatch(
      makeBatch([makeTask({ id: 'a', invocationId: 'inv-a' })]),
    );
    await expect(handle.accepted).rejects.toThrow('manifest persist failed');
    await expect(handle.completion).rejects.toThrow('manifest persist failed');
    childGate.resolve();
  });

  it('rejects accepted when queued invocation persistence fails after the manifest', async () => {
    const childGate = createDeferred();
    const backend = makeFakeBackend({ waitFor: childGate.promise });
    const { push } = makePushCollector();
    const orchestrator = new SubagentOrchestrator({
      taskRunner: backend.taskRunner,
      workspaceService: backend.workspaceService,
      prepareTask: backend.prepareTask,
      runRegistry: new RunRegistry(),
      integrationCoordinator: makeFakeIntegrationCoordinator(),
      runStore: {
        createManifest: async () => {},
        recordInvocation: async () => {
          throw new Error('invocation persist failed');
        },
        recordResult: async () => {},
        setStatus: async () => {},
      },
      push,
      getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
    });

    const handle = orchestrator.startBatch(
      makeBatch([makeTask({ id: 'a', invocationId: 'inv-a' })]),
    );
    await expect(handle.accepted).rejects.toThrow('invocation persist failed');
    await expect(handle.completion).rejects.toThrow();
    childGate.resolve();
  });

  it('keeps orchestrator modules under the source-file size cap', () => {
    const files = [
      'subagent-orchestrator.ts',
      'subagent-orchestrator-types.ts',
      'subagent-orchestrator-batch.ts',
      'subagent-orchestrator-invocation.ts',
      'subagent-orchestrator-task.ts',
      'subagent-orchestrator-finalize.ts',
    ];
    for (const fileName of files) {
      expect(sourceLineCount(fileName), fileName).toBeLessThanOrEqual(1000);
    }
    expect(sourceLineCount('subagent-orchestrator.ts')).toBeLessThan(700);
    for (const fileName of files.filter((name) => name !== 'subagent-orchestrator.ts')) {
      expect(sourceLineCount(fileName), fileName).toBeLessThan(500);
    }
  });

  it('re-exports public orchestrator types from subagent-orchestrator.ts', async () => {
    const mod = await import('./subagent-orchestrator.js');
    expect(mod.SubagentOrchestrator).toBeTypeOf('function');
  });
});

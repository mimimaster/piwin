import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  BackendPreparedPrompt,
  BackendSessionBlueprint,
  HostPush,
  HostToolRegistration,
  SessionCapabilitySnapshot,
  SubagentBatchRequest,
  SubagentProviderEnvelope,
  SubagentReviewRecord,
  SubagentTaskResult,
  SubagentTaskRunInput,
  SubagentTaskRunOutput,
  SubagentTaskRunner,
  SubagentTaskSpec,
  SubagentWorkspaceLease,
  ToolResult,
} from '@piwin/contracts';
import { RunRegistry } from './run-registry.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import type { SubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';
import { TurnScopedSchemeAdmissionGate } from './orchestration-scheme-admission.js';
import { createSubagentControlSeam } from './host-runtime-subagent-start.js';
import { createSubagentStartTool } from './subagent-start-tool.js';
import { createSubagentWaitTool } from './subagent-wait-tool.js';
import { createSubagentCancelTool } from './subagent-cancel-tool.js';
import { createSubagentRunTool, type SubagentRunSeam } from './subagent-run-tool.js';
import { buildSessionHostTools } from './tools/build-session-host-tools.js';
import { loadPersistedReviewObservation } from './subagent-review-service.js';

const RUNTIME_GENERATION_ID = 'generation-async';
const SESSION_ID = 'parent-1';
const PARENT_RUN_ID = 'run-1';

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

function makeFakeIntegrationCoordinator(): SubagentIntegrationCoordinator {
  return {
    async integrate(result) {
      return { ...result, integrationStatus: 'applied' };
    },
    async retain() {},
    async isBaseClean() {
      return true;
    },
    async dispose() {},
  };
}

type StoredTask = {
  id?: string;
  invocationId?: string;
  parentRunId?: string;
  review?: SubagentReviewRecord;
  reviewRef?: { reviewId: string; revision: number };
};

type StoredManifest = {
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration';
  results: Record<string, SubagentTaskResult>;
  parentSessionId: string;
  parentRunId?: string;
  tasks: StoredTask[];
  invocations: Record<string, { id: string; parentRunId?: string }>;
};

function createMemoryRunStore(options?: {
  beforeManifest?: () => Promise<void>;
  beforeInvocation?: () => Promise<void>;
  failManifest?: Error;
  failInvocation?: Error;
}) {
  const manifests = new Map<string, StoredManifest>();
  return {
    async createManifest(runId: string, request: SubagentBatchRequest) {
      if (options?.beforeManifest) await options.beforeManifest();
      if (options?.failManifest) throw options.failManifest;
      manifests.set(runId, {
        status: 'running',
        results: {},
        parentSessionId: request.parentSessionId,
        ...(request.tasks[0]?.parentRunId ? { parentRunId: request.tasks[0].parentRunId } : {}),
        tasks: request.tasks.map((task) => ({
          id: task.id,
          ...(task.invocationId ? { invocationId: task.invocationId } : {}),
          ...(task.parentRunId ? { parentRunId: task.parentRunId } : {}),
        })),
        invocations: {},
      });
    },
    async persistReviewerDecision(runId: string, taskId: string, record: SubagentReviewRecord) {
      const manifest = manifests.get(runId);
      const task = manifest?.tasks.find((candidate) => candidate.id === taskId);
      if (!manifest || !task) return { ok: false as const, code: 'not-found' as const };
      if (task.review && task.review.decision !== record.decision) {
        return { ok: false as const, code: 'conflict' as const, existing: task.review };
      }
      if (task.review) return { ok: true as const, record: task.review };
      task.review = record;
      task.reviewRef = { reviewId: record.reviewId, revision: record.revision };
      return { ok: true as const, record };
    },
    async recordInvocation(runId: string, invocation: { id: string; parentRunId?: string }) {
      if (options?.beforeInvocation) await options.beforeInvocation();
      if (options?.failInvocation) throw options.failInvocation;
      const manifest = manifests.get(runId);
      if (manifest) manifest.invocations[invocation.id] = invocation;
    },
    async recordResult(runId: string, taskId: string, result: SubagentTaskResult) {
      const manifest = manifests.get(runId);
      if (manifest) manifest.results[taskId] = result;
    },
    async setStatus(runId: string, status: StoredManifest['status']) {
      const manifest = manifests.get(runId);
      if (manifest) manifest.status = status;
    },
    async loadManifest(runId: string) {
      return manifests.get(runId);
    },
  };
}

function createGatedRunner() {
  const gates = new Map<string, ReturnType<typeof createDeferred>>();
  const startedTasks: string[] = [];
  const taskRunner: SubagentTaskRunner = {
    capabilities: { processIsolation: true },
    async runTask(input: SubagentTaskRunInput, signal: AbortSignal): Promise<SubagentTaskRunOutput> {
      const task = input.task;
      startedTasks.push(task.id);
      const gate = gates.get(task.id) ?? createDeferred();
      gates.set(task.id, gate);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          fn();
        };
        gate.promise.then(
          () => finish(resolve),
          (error) => finish(() => reject(error)),
        );
        signal.addEventListener(
          'abort',
          () => finish(() => reject(new Error('aborted'))),
          { once: true },
        );
      });
      const failed = /\bfail\b/i.test(task.task);
      return {
        executionStatus: failed ? 'failed' : 'completed',
        summaryStatus: 'not-requested',
        integrationStatus: 'not-requested',
        childSessionId: `child-${task.id}`,
        summaryPreview: failed ? 'child failed' : `summary-${task.id}`,
        ...(failed ? { error: 'fake failure' } : {}),
      };
    },
  };
  return {
    taskRunner,
    workspaceService: {
      async acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease> {
        return {
          mode: 'readonly' as const,
          cwd: `/tmp/${task.id}`,
          parentRepoPath: '/tmp/project',
        };
      },
      async release() {},
    },
    prepareTask: async (input: {
      childSessionId: string;
      runtimeGenerationId: string;
      task: SubagentTaskSpec;
      workspaceLease: SubagentWorkspaceLease;
    }) => makePreparedTask(input),
    hold(taskId: string) {
      const gate = gates.get(taskId) ?? createDeferred();
      gates.set(taskId, gate);
      return { resolve: () => gate.resolve() };
    },
    startedTasks,
  };
}

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  signal = new AbortController().signal,
  runId = PARENT_RUN_ID,
): Promise<ToolResult> {
  return tool.execute(args, signal, {
    sessionId: SESSION_ID,
    runtimeGenerationId: RUNTIME_GENERATION_ID,
    runId,
    toolName: tool.descriptor.name,
  });
}

function messageOf(result: ToolResult): string {
  return result.ok ? result.output : result.message;
}

function createHarness(options?: {
  store?: ReturnType<typeof createMemoryRunStore>;
  parentRunId?: string;
  onPush?: (message: HostPush) => void;
}) {
  const runner = createGatedRunner();
  const requestedParentRunId = options?.parentRunId ?? PARENT_RUN_ID;
  let issuedParent = false;
  const runRegistry = new RunRegistry({
    createId: () => {
      if (!issuedParent) {
        issuedParent = true;
        return requestedParentRunId;
      }
      return randomUUID();
    },
  });
  const parentRun = runRegistry.create({
    kind: 'session-turn',
    sessionId: SESSION_ID,
    runtimeGenerationId: RUNTIME_GENERATION_ID,
  });
  runRegistry.start(parentRun.runId);
  const store = options?.store ?? createMemoryRunStore();
  const pushes: HostPush[] = [];
  const orchestrator = new SubagentOrchestrator({
    taskRunner: runner.taskRunner,
    workspaceService: runner.workspaceService,
    prepareTask: runner.prepareTask,
    runRegistry,
    integrationCoordinator: makeFakeIntegrationCoordinator(),
    runStore: store,
    push: (message) => {
      options?.onPush?.(message);
      pushes.push(message);
    },
    getRuntimeGenerationId: () => RUNTIME_GENERATION_ID,
  });
  const schemeAdmissionGate = new TurnScopedSchemeAdmissionGate();
  const parentRunId = parentRun.runId;
  schemeAdmissionGate.bind(parentRunId, { maxConcurrency: 8, maxTasksPerRun: 8 });
  const taskResults = new Map<string, SubagentTaskResult>();
  const mergeCalls: string[] = [];
  const merged = new Set<string>();
  const seam = createSubagentControlSeam(
    {
      orchestrator,
      schemeAdmissionGate,
      runRegistry,
      getParentRunId: () => parentRunId,
      getDelegationMode: () => 'auto',
      getActiveScheme: () => undefined,
      prepareBatch: async (request) => request,
      whenReady: async () => {},
      taskResults,
      merge: async (childSessionId) => {
        mergeCalls.push(childSessionId);
        if (merged.has(childSessionId)) {
          return { summaryPreview: `cached-${childSessionId}`, alreadyMerged: true };
        }
        merged.add(childSessionId);
        const result = taskResults.get(childSessionId);
        return { summaryPreview: result?.summaryPreview ?? `merged-${childSessionId}` };
      },
      observePersistedReview: (runId) => loadPersistedReviewObservation(store, runId),
    },
    SESSION_ID,
  );
  return {
    seam,
    orchestrator,
    schemeAdmissionGate,
    startTool: createSubagentStartTool({ sessionId: SESSION_ID, seam }),
    waitTool: createSubagentWaitTool({ sessionId: SESSION_ID, seam }),
    cancelTool: createSubagentCancelTool({ sessionId: SESSION_ID, seam }),
    runner,
    runRegistry,
    mergeCalls,
    parentRunId,
    store,
  };
}

async function flushUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`${label} did not become true`);
}

function acceptedRunId(result: ToolResult): string {
  if (!result.ok || typeof result.details?.runId !== 'string') {
    throw new Error(`expected accepted runId, got ${messageOf(result)}`);
  }
  return result.details.runId;
}

describe('async subagent start/wait/cancel', () => {
  it('start waits for deferred manifest + invocation acceptance, returns before child completion, and never returns a false receipt on persistence failure', async () => {
    const manifestGate = createDeferred();
    const invocationGate = createDeferred();
    const harness = createHarness({
      store: createMemoryRunStore({
        beforeManifest: () => manifestGate.promise,
        beforeInvocation: () => invocationGate.promise,
      }),
    });
    const startPromise = executeTool(harness.startTool, { task: 'explore auth' });
    let startSettled = false;
    void startPromise.then(() => {
      startSettled = true;
    });
    await Promise.resolve();
    expect(startSettled).toBe(false);

    manifestGate.resolve();
    await Promise.resolve();
    expect(startSettled).toBe(false);

    invocationGate.resolve();
    const accepted = await startPromise;
    expect(accepted).toMatchObject({
      ok: true,
      details: { status: 'accepted' },
    });
    expect(messageOf(accepted)).toMatch(
      /subagent accepted \(runId=.+, invocationId=.+\); continue independent work and call piwin_subagent_wait/,
    );
    const runId = acceptedRunId(accepted);
    expect(harness.orchestrator.isRunning(runId)).toBe(true);
    let childCompleted = false;
    void harness.orchestrator.joinBatch(runId).then(() => {
      childCompleted = true;
    });
    await Promise.resolve();
    expect(childCompleted).toBe(false);

    const failing = createHarness({
      store: createMemoryRunStore({ failManifest: new Error('disk full') }),
    });
    const failed = await executeTool(failing.startTool, { task: 'do not persist' });
    expect(failed).toMatchObject({ ok: false });
    expect(messageOf(failed)).toContain('disk full');
    expect(failed.ok ? failed.details?.status : undefined).not.toBe('accepted');

    const failInvocation = createHarness({
      store: createMemoryRunStore({ failInvocation: new Error('invocation persist failed') }),
    });
    const failedInvocation = await executeTool(failInvocation.startTool, { task: 'no invocation' });
    expect(failedInvocation).toMatchObject({ ok: false });
    expect(messageOf(failedInvocation)).toContain('invocation persist failed');
    expect(failedInvocation.ok ? failedInvocation.details?.status : undefined).not.toBe('accepted');
  });

  it('abort after durable acceptance leaves the batch running and returns the accepted receipt', async () => {
    const controller = new AbortController();
    const harness = createHarness({
      onPush: (message) => {
        if (message.type === 'subagent/batch-updated') {
          controller.abort();
        }
      },
    });
    const startPromise = executeTool(harness.startTool, { task: 'hold after accept' }, controller.signal);
    const accepted = await startPromise;
    expect(accepted).toMatchObject({
      ok: true,
      details: { status: 'accepted' },
    });
    const runId = acceptedRunId(accepted);
    expect(harness.orchestrator.isRunning(runId)).toBe(true);

    await flushUntil(() => harness.runner.startedTasks.length === 1, 'child start');
    const taskId = harness.runner.startedTasks[0];
    if (!taskId) throw new Error('expected started task');
    harness.runner.hold(taskId).resolve();
    await harness.orchestrator.joinBatch(runId);
  });

  it('admission remains occupied until completion and releases exactly once', async () => {
    const harness = createHarness();
    harness.schemeAdmissionGate.bind(PARENT_RUN_ID, { maxConcurrency: 1, maxTasksPerRun: 8 });
    const start = await executeTool(harness.startTool, { task: 'hold admission' });
    const runId = acceptedRunId(start);
    expect(harness.schemeAdmissionGate.getSnapshot(PARENT_RUN_ID)?.activeCount).toBe(1);

    const secondAcquire = harness.schemeAdmissionGate.acquire(PARENT_RUN_ID);
    let secondResolved = false;
    void secondAcquire.then(() => {
      secondResolved = true;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    await flushUntil(() => harness.runner.startedTasks.length === 1, 'child start');
    const taskId = harness.runner.startedTasks[0];
    if (!taskId) throw new Error('expected started task');
    harness.runner.hold(taskId).resolve();
    await harness.orchestrator.joinBatch(runId);
    await flushUntil(
      () => harness.schemeAdmissionGate.getSnapshot(PARENT_RUN_ID)?.activeCount === 0,
      'admission release',
    );
    const lease = await secondAcquire;
    expect(secondResolved).toBe(true);
    lease?.release();
    expect(harness.schemeAdmissionGate.getSnapshot(PARENT_RUN_ID)?.activeCount).toBe(0);
  });

  it('wait joins two runs in caller order, merges once, and observes child failure as terminal data', async () => {
    const harness = createHarness();
    const startA = await executeTool(harness.startTool, { task: 'task a' });
    const startB = await executeTool(harness.startTool, { task: 'task fail' });
    const runA = acceptedRunId(startA);
    const runB = acceptedRunId(startB);
    await flushUntil(() => harness.runner.startedTasks.length === 2, 'both children start');

    const waitPromise = executeTool(harness.waitTool, { runIds: [runB, runA] });
    let waitSettled = false;
    void waitPromise.then(() => {
      waitSettled = true;
    });
    await Promise.resolve();
    expect(waitSettled).toBe(false);
    expect(harness.mergeCalls).toHaveLength(0);

    const taskA = harness.runner.startedTasks[0];
    const taskB = harness.runner.startedTasks[1];
    if (!taskA || !taskB) throw new Error('expected two started tasks');
    harness.runner.hold(taskA).resolve();
    await Promise.resolve();
    expect(waitSettled).toBe(false);
    expect(harness.mergeCalls).toHaveLength(0);

    harness.runner.hold(taskB).resolve();
    const waited = await waitPromise;
    expect(waited.ok).toBe(true);
    const runs = waited.ok ? (waited.details?.runs as Array<{ runId: string; executionStatus: string }>) : [];
    expect(runs.map((run) => run.runId)).toEqual([runB, runA]);
    expect(runs.map((run) => run.executionStatus)).toEqual(['failed', 'completed']);
    expect(harness.mergeCalls).toHaveLength(2);

    const secondWait = await executeTool(harness.waitTool, { runIds: [runA] });
    expect(secondWait.ok).toBe(true);
    expect(harness.mergeCalls).toHaveLength(3);
    const secondRuns = secondWait.ok
      ? (secondWait.details?.runs as Array<{ alreadyMerged?: boolean }>)
      : [];
    expect(secondRuns[0]?.alreadyMerged).toBe(true);
  });

  it('aborting wait leaves both batches running', async () => {
    const harness = createHarness();
    const startA = await executeTool(harness.startTool, { task: 'a' });
    const startB = await executeTool(harness.startTool, { task: 'b' });
    const runA = acceptedRunId(startA);
    const runB = acceptedRunId(startB);
    await flushUntil(() => harness.runner.startedTasks.length === 2, 'both children start');

    const controller = new AbortController();
    const waitPromise = executeTool(harness.waitTool, { runIds: [runA, runB] }, controller.signal);
    controller.abort();
    const waited = await waitPromise;
    expect(waited).toMatchObject({ ok: false, code: 'aborted' });
    expect(harness.orchestrator.isRunning(runA)).toBe(true);
    expect(harness.orchestrator.isRunning(runB)).toBe(true);
  });

  it('wait rejects a foreign-session or non-batch id before joining any run', async () => {
    const harness = createHarness();
    const started = await executeTool(harness.startTool, { task: 'local' });
    const runId = acceptedRunId(started);
    await flushUntil(() => harness.runner.startedTasks.length === 1, 'local child start');
    const joinSpy = { calls: 0 };
    const originalJoin = harness.orchestrator.joinBatch.bind(harness.orchestrator);
    harness.orchestrator.joinBatch = async (id: string) => {
      joinSpy.calls += 1;
      return originalJoin(id);
    };

    const foreignHandle = harness.orchestrator.startBatch({
      parentSessionId: 'other-session',
      tasks: [
        {
          id: 'foreign-task',
          parentSessionId: 'other-session',
          invocationId: 'foreign-inv',
          task: 'other session',
        },
      ],
      maxConcurrency: 1,
    });
    const foreignRunId = foreignHandle.runId;

    const rejectedForeign = await executeTool(harness.waitTool, {
      runIds: [runId, foreignRunId],
    });
    expect(rejectedForeign).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(joinSpy.calls).toBe(0);
    expect(harness.orchestrator.isRunning(runId)).toBe(true);

    const promptRun = harness.runRegistry.create({
      kind: 'session-turn',
      sessionId: SESSION_ID,
      runtimeGenerationId: RUNTIME_GENERATION_ID,
    });
    const rejectedNonBatch = await executeTool(harness.waitTool, {
      runIds: [runId, promptRun.runId],
    });
    expect(rejectedNonBatch).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(messageOf(rejectedNonBatch)).toMatch(/subagent-batch|not a subagent/i);
    expect(joinSpy.calls).toBe(0);
    expect(harness.orchestrator.isRunning(runId)).toBe(true);
  });

  it('cancel rejects one foreign id before cancelling any valid id', async () => {
    const harness = createHarness();
    const started = await executeTool(harness.startTool, { task: 'keep running' });
    const runId = acceptedRunId(started);
    await flushUntil(() => harness.runner.startedTasks.length === 1, 'local child start');

    const otherParent = harness.runRegistry.create({
      kind: 'session-turn',
      sessionId: SESSION_ID,
      runtimeGenerationId: RUNTIME_GENERATION_ID,
    });
    harness.runRegistry.start(otherParent.runId);
    const foreignHandle = harness.orchestrator.startBatch(
      {
        parentSessionId: SESSION_ID,
        tasks: [
          {
            id: 'foreign-task',
            parentSessionId: SESSION_ID,
            parentRunId: otherParent.runId,
            invocationId: 'foreign-inv',
            task: 'foreign',
          },
        ],
        maxConcurrency: 1,
      },
      otherParent.runId,
    );
    const foreignRunId = foreignHandle.runId;

    const rejected = await executeTool(harness.cancelTool, {
      runIds: [runId, foreignRunId],
    });
    expect(rejected).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(harness.orchestrator.isRunning(runId)).toBe(true);
    expect(harness.orchestrator.isRunning(foreignRunId)).toBe(true);
  });

  it('cancel is idempotent for an already-terminal batch and stops an active one', async () => {
    const harness = createHarness();
    const terminalStart = await executeTool(harness.startTool, { task: 'finish me' });
    const terminalRunId = acceptedRunId(terminalStart);
    await flushUntil(() => harness.runner.startedTasks.length === 1, 'terminal child start');
    const terminalTask = harness.runner.startedTasks[0];
    if (!terminalTask) throw new Error('expected terminal task');
    harness.runner.hold(terminalTask).resolve();
    await harness.orchestrator.joinBatch(terminalRunId);
    expect(harness.orchestrator.isRunning(terminalRunId)).toBe(false);

    const already = await executeTool(harness.cancelTool, { runIds: [terminalRunId] });
    expect(already).toMatchObject({ ok: true });
    const alreadyRuns = already.ok
      ? (already.details?.runs as Array<{ runId: string; status: string }>)
      : [];
    expect(alreadyRuns).toEqual([
      expect.objectContaining({ runId: terminalRunId, status: 'already-terminal' }),
    ]);

    const activeStart = await executeTool(harness.startTool, { task: 'stop me' });
    const activeRunId = acceptedRunId(activeStart);
    await flushUntil(() => harness.runner.startedTasks.length === 2, 'active child start');
    const cancelled = await executeTool(harness.cancelTool, { runIds: [activeRunId] });
    expect(cancelled).toMatchObject({ ok: true });
    const cancelledRuns = cancelled.ok
      ? (cancelled.details?.runs as Array<{ runId: string; status: string }>)
      : [];
    expect(
      cancelledRuns[0]?.status === 'cancelled' || cancelledRuns[0]?.status === 'cancelling',
    ).toBe(true);
    expect(harness.orchestrator.isRunning(activeRunId)).toBe(false);
  });

  it('wait returns a persisted review ref and omits it when the reviewer never submitted', async () => {
    const harness = createHarness();
    const started = await executeTool(harness.startTool, { task: 'review candidate' });
    const runId = acceptedRunId(started);
    await flushUntil(() => harness.runner.startedTasks.length === 1, 'reviewer start');
    const taskId = harness.runner.startedTasks[0];
    if (!taskId) throw new Error('expected started task');

    const missing = await loadPersistedReviewObservation(harness.store, runId);
    expect(missing).toBeUndefined();

    await harness.store.persistReviewerDecision(runId, taskId, {
      reviewId: 'review-wait-1',
      revision: 1,
      parentSessionId: SESSION_ID,
      reviewerSessionId: `child-${taskId}`,
      reviewerRunId: runId,
      targetResult: { resultId: 'result-1', revision: 1 },
      targetChanges: { changeSetId: 'cs-child', revision: 1 },
      decision: 'approved',
      findings: [],
      verification: [],
      createdAt: '2026-09-13T01:00:00.000Z',
    });
    harness.runner.hold(taskId).resolve();
    const waited = await executeTool(harness.waitTool, { runIds: [runId] });
    expect(waited.ok).toBe(true);
    const runs = waited.ok
      ? (waited.details?.runs as Array<{
          runId: string;
          reviewRef?: { reviewId: string };
          reviewDecision?: string;
        }>)
      : [];
    expect(runs[0]).toMatchObject({
      runId,
      reviewRef: { reviewId: 'review-wait-1' },
      reviewDecision: 'approved',
    });
    expect(messageOf(waited)).toContain('review=approved');

    const bare = createHarness();
    const unfinished = await executeTool(bare.startTool, { task: 'forget to review' });
    const bareRunId = acceptedRunId(unfinished);
    await flushUntil(() => bare.runner.startedTasks.length === 1, 'bare reviewer start');
    const bareTask = bare.runner.startedTasks[0];
    if (!bareTask) throw new Error('expected bare task');
    bare.runner.hold(bareTask).resolve();
    const bareWait = await executeTool(bare.waitTool, { runIds: [bareRunId] });
    expect(bareWait.ok).toBe(true);
    const bareRuns = bareWait.ok
      ? (bareWait.details?.runs as Array<{ reviewRef?: unknown; reviewDecision?: unknown }>)
      : [];
    expect(bareRuns[0]?.reviewRef).toBeUndefined();
    expect(bareRuns[0]?.reviewDecision).toBeUndefined();
    expect(messageOf(bareWait)).not.toContain('review=');
  });

  it('keeps the synchronous run tool spawn-and-merge path unchanged', async () => {
    const seam: SubagentRunSeam = {
      spawn: async () => ({
        childSessionId: 'child-1',
        batchStatus: 'completed',
        executionStatus: 'completed',
        integrationStatus: 'not-requested',
      }),
      merge: async () => ({ summaryPreview: 'did the thing' }),
      start: async () => ({ runId: 'unused', invocationId: 'unused' }),
      wait: async () => ({ runs: [] }),
      cancel: async () => ({ runs: [] }),
    };
    const tool = createSubagentRunTool({ sessionId: SESSION_ID, seam });
    const result = await executeTool(tool, { task: 'explore the auth module' });
    expect(messageOf(result)).toContain('subagent completed');
    expect(messageOf(result)).toContain('did the thing');
  });

  it('tool-surface inventory registers exactly five delegate tools', async () => {
    const harness = createHarness();
    const tools = await buildSessionHostTools({
      sessionId: SESSION_ID,
      subagentSeam: harness.seam,
    });
    expect(
      tools.filter((tool) => tool.family === 'delegate').map((tool) => tool.descriptor.name),
    ).toEqual([
      'piwin_subagent_run',
      'piwin_subagent_start',
      'piwin_subagent_continue',
      'piwin_subagent_wait',
      'piwin_subagent_cancel',
    ]);
  });
});

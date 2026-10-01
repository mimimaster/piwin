import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  HostToolRegistration,
  ResolvedOrchestrationScheme,
  SessionIndexRecord,
  SubagentBatchRequest,
  SubagentResultSummary,
  SubagentTaskResult,
  ToolResult,
} from '@piwin/contracts';
import {
  AUTO_SCHEME_ID,
  FUSION_SCHEME_ID,
  REVIEWED_DELIVERY_SCHEME_ID,
  PIWIN_FUSION_BRIEF_MARKER,
  emptySubagentResultReviewFields,
  resolveOrchestrationScheme,
} from '@piwin/contracts';
import type { PreparedSubagentContinuation } from './subagent-continuation-prep.js';
import { RunRegistry } from './run-registry.js';
import { TurnScopedSchemeAdmissionGate } from './orchestration-scheme-admission.js';
import { createSubagentControlSeam } from './host-runtime-subagent-start.js';
import { createSubagentStartTool } from './subagent-start-tool.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { bindSubagentReviewTarget } from './subagent-review-context.js';
import { DetachedSubagentRegistry } from './detached-subagent-reports.js';

const SESSION_ID = 'parent-1';
const PARENT_RUN_ID = 'run-1';

function makeSummary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: SESSION_ID,
    childSessionId: 'child-1',
    taskId: 'task-1',
    batchRunId: 'run-worker',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-child', revision: 1 },
    appliedChanges: null,
    copyState: 'present',
    latestOperationId: null,
    availability: {
      view: { allowed: true },
      apply: { allowed: true },
      resolve: { allowed: true },
      cleanup: { allowed: true },
    },
    ...overrides,
  };
}

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: SESSION_ID,
    runtimeGenerationId: 'generation-1',
    runId: PARENT_RUN_ID,
    toolName: tool.descriptor.name,
  });
}

function reviewedDeliveryScheme(): ResolvedOrchestrationScheme {
  const resolved = resolveOrchestrationScheme(
    { maxConcurrency: 4, maxTasksPerRun: 8 },
    REVIEWED_DELIVERY_SCHEME_ID,
    { knownProfileIds: ['implementer', 'reviewer'] },
  );
  if (!resolved) throw new Error('expected builtin reviewed-delivery scheme');
  return resolved;
}

function fusionScheme(): ResolvedOrchestrationScheme {
  const resolved = resolveOrchestrationScheme(
    { maxConcurrency: 4, maxTasksPerRun: 8 },
    FUSION_SCHEME_ID,
    { knownProfileIds: ['implementer'] },
  );
  if (!resolved) throw new Error('expected builtin fusion scheme');
  return resolved;
}

const FUSION_WORKTREE_LEASE = {
  mode: 'worktree' as const,
  cwd: '/tmp/fusion-wt',
  parentRepoPath: '/tmp/project',
  worktreePath: '/tmp/fusion-wt',
  worktreeBranch: 'piwin/fusion-lane',
  baseCommit: 'abc123',
};

function sessionRecord(overrides: Partial<SessionIndexRecord>): SessionIndexRecord {
  return {
    id: 'record',
    projectPath: '/tmp/project',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    messageCount: 1,
    ...overrides,
  };
}

function fusionLaneContinuation(childId: string): PreparedSubagentContinuation {
  return {
    child: sessionRecord({
      id: childId,
      kind: 'subagent',
      parentSessionId: SESSION_ID,
      subagentRole: 'sidekick',
      subagentStatus: 'done',
      subagentMode: 'worktree',
      subagentRetainWorktree: true,
      worktreePath: FUSION_WORKTREE_LEASE.worktreePath,
      subagentRuntime: { isolation: 'worktree', workingDirectory: FUSION_WORKTREE_LEASE.cwd },
    }),
    parent: sessionRecord({ id: SESSION_ID, kind: 'main' }),
    runtime: { isolation: 'worktree', workingDirectory: FUSION_WORKTREE_LEASE.cwd },
    mode: 'worktree',
    continuationWorkspaceLease: FUSION_WORKTREE_LEASE,
  };
}

function createHarness(options?: {
  summary?: SubagentResultSummary | undefined;
  getActiveScheme?: () => ResolvedOrchestrationScheme | undefined;
  resolveFusionLane?: (
    parentSessionId: string,
  ) => Promise<PreparedSubagentContinuation | undefined>;
  detachedRegistry?: DetachedSubagentRegistry;
  onDetachedBatchSettled?: (input: { sessionId: string; runId: string; schemeId?: string }) => void;
}) {
  const batches: SubagentBatchRequest[] = [];
  const batchParentRunIds: Array<string | undefined> = [];
  const freehandSelections: boolean[] = [];
  const summary = options && 'summary' in options ? options.summary : makeSummary();
  const runRegistry = new RunRegistry({
    createId: (() => {
      let issuedParent = false;
      return () => {
        if (!issuedParent) {
          issuedParent = true;
          return PARENT_RUN_ID;
        }
        return randomUUID();
      };
    })(),
  });
  const parentRun = runRegistry.create({
    kind: 'session-turn',
    sessionId: SESSION_ID,
    runtimeGenerationId: 'generation-1',
  });
  runRegistry.start(parentRun.runId);
  const orchestrator = new SubagentOrchestrator({
    taskRunner: {
      capabilities: { processIsolation: true },
      async runTask() {
        return {
          executionStatus: 'completed',
          summaryStatus: 'not-requested',
          integrationStatus: 'not-requested',
          childSessionId: 'child-reviewer',
        };
      },
    },
    workspaceService: {
      async acquire(task) {
        if (task.continuationWorkspaceLease) return task.continuationWorkspaceLease;
        if (task.isolationOverride === 'worktree') return FUSION_WORKTREE_LEASE;
        return { mode: 'readonly', cwd: '/tmp/reviewer', parentRepoPath: '/tmp/project' };
      },
      async release() {},
    },
    prepareTask: async (input) => ({
      runtimeSnapshot: { isolation: input.workspaceLease.mode, workingDirectory: input.workspaceLease.cwd },
      sessionBlueprint: {
        version: 1,
        sessionId: input.childSessionId,
        runtimeGenerationId: input.runtimeGenerationId,
        capabilitySnapshot: {
          version: 1,
          snapshotId: 'snap',
          inputs: {
            rulesRevision: 'r',
            settingsRevision: 's',
            projectRevision: 'p',
            mcpRevision: 'm',
            resourceCatalogRevision: 'c',
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
          tools: { hostTools: [], piBuiltinToolNames: [], enabledMcpServerIds: [], enabledFamilies: [] },
        },
      },
      preparedPrompt: { text: input.task.task, runId: input.taskRunId },
      providers: [],
    }),
    runRegistry,
    integrationCoordinator: {
      async integrate(result: SubagentTaskResult) {
        return { ...result, integrationStatus: 'applied' };
      },
      async retain() {},
      async isBaseClean() {
        return true;
      },
      async dispose() {},
    },
    push: () => {},
    getRuntimeGenerationId: () => 'generation-1',
  });
  const startBatch = orchestrator.startBatch.bind(orchestrator);
  orchestrator.startBatch = (request, parentRunId) => {
    batches.push(request);
    batchParentRunIds.push(parentRunId);
    return startBatch(request, parentRunId);
  };
  const schemeAdmissionGate = new TurnScopedSchemeAdmissionGate();
  schemeAdmissionGate.bind(parentRun.runId, { maxConcurrency: 8, maxTasksPerRun: 8 });
  const seam = createSubagentControlSeam(
    {
      orchestrator,
      schemeAdmissionGate,
      runRegistry,
      getParentRunId: () => parentRun.runId,
      getDelegationMode: () => 'auto',
      getActiveScheme: options?.getActiveScheme ?? (() => undefined),
      prepareBatch: async (request, source) => {
        freehandSelections.push(source === 'model-tool-freehand');
        return request;
      },
      whenReady: async () => {},
      taskResults: new Map(),
      bindReviewTarget: (input) =>
        bindSubagentReviewTarget({
          ...input,
          getResult: () => summary,
        }),
      merge: async () => ({}),
      ...(options?.resolveFusionLane ? { resolveFusionLane: options.resolveFusionLane } : {}),
      ...(options?.detachedRegistry ? { detachedRegistry: options.detachedRegistry } : {}),
      ...(options?.onDetachedBatchSettled
        ? { onDetachedBatchSettled: options.onDetachedBatchSettled }
        : {}),
    },
    SESSION_ID,
  );
  return {
    batches,
    batchParentRunIds,
    orchestrator,
    schemeAdmissionGate,
    freehandSelections,
    seam,
    startTool: createSubagentStartTool({ sessionId: SESSION_ID, seam }),
  };
}

describe('model-facing freehand routing flag', () => {
  it('marks synchronous and async freehand calls, but not selected schemes', async () => {
    const freehand = createHarness();
    await freehand.seam.spawn({
      parentSessionId: SESSION_ID, parentRunId: PARENT_RUN_ID, invocationId: 'sync', task: 'inspect',
    });
    expect((await executeTool(freehand.startTool, { task: 'inspect' })).ok).toBe(true);
    expect(freehand.freehandSelections).toEqual([true, true]);

    const scheme = createHarness({ getActiveScheme: reviewedDeliveryScheme });
    expect((await executeTool(scheme.startTool, { task: 'review candidate', role: 'reviewer' })).ok).toBe(true);
    expect(scheme.freehandSelections).toEqual([false]);
  });
});

describe('piwin_subagent_start reviewOf', () => {
  it('stores the Host-bound reviewTarget on the reviewer task', async () => {
    const harness = createHarness();
    const result = await executeTool(harness.startTool, {
      task: 'review the login candidate',
      role: 'reviewer',
      mode: 'readonly',
      reviewOf: { resultId: 'result-1', revision: 1 },
    });
    expect(result.ok).toBe(true);
    expect(harness.batches[0]?.tasks[0]?.reviewTarget).toEqual({
      result: { resultId: 'result-1', revision: 1 },
      changes: { changeSetId: 'cs-child', revision: 1 },
    });
  });

  it('rejects a worktree role and expired frozen data', async () => {
    const worktree = createHarness();
    expect(
      await executeTool(worktree.startTool, {
        task: 'review the login candidate',
        role: 'reviewer',
        mode: 'worktree',
        reviewOf: { resultId: 'result-1', revision: 1 },
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });

    const expired = createHarness({
      summary: makeSummary({ childChanges: null }),
    });
    expect(
      await executeTool(expired.startTool, {
        task: 'review the login candidate',
        role: 'reviewer',
        mode: 'readonly',
        reviewOf: { resultId: 'result-1', revision: 1 },
      }),
    ).toMatchObject({ ok: false, code: 'review-data-expired' });
  });
});

describe('piwin_subagent_start fusion seam', () => {
  it('wraps the first sidekick spawn as an explicit candidate brief', async () => {
    const harness = createHarness({ getActiveScheme: fusionScheme });
    const result = await executeTool(harness.startTool, {
      task: 'fix the flake',
    });
    expect(result.ok).toBe(true);
    const task = harness.batches[0]?.tasks[0];
    expect(task?.role).toBe('sidekick');
    expect(task?.isolationOverride).toBe('worktree');
    expect(task?.deliveryIntent).toBe('candidate');
    expect(task?.applyPolicy).toBe('explicit');
    expect(task?.retainWorktree).toBeUndefined();
    expect(task?.capabilities).not.toContain('delegate');
    expect(task?.capabilities).toContain('write');
    expect(task?.continuationSessionId).toBeUndefined();
    expect(task?.task).toContain(PIWIN_FUSION_BRIEF_MARKER);
    expect(task?.task).toMatch(/cannot see the parent conversation/i);
    expect(task?.task).toContain('fix the flake');
  });

  it('reuses the retained sidekick lane without copying parent history', async () => {
    const harness = createHarness({
      getActiveScheme: fusionScheme,
      resolveFusionLane: async () => fusionLaneContinuation('lane-child'),
    });
    const result = await executeTool(harness.startTool, {
      task: 'second brief',
      role: 'sidekick',
    });
    expect(result.ok).toBe(true);
    const task = harness.batches[0]?.tasks[0];
    expect(task?.continuationSessionId).toBe('lane-child');
    expect(task?.continuationWorkspaceLease).toEqual(FUSION_WORKTREE_LEASE);
    expect(task?.task).toContain('second brief');
    expect(task?.task).toContain(PIWIN_FUSION_BRIEF_MARKER);
    expect(task?.task).not.toMatch(/parent history|user said/i);
  });

  it('locks a Reviewed Delivery worker to an explicit candidate the model cannot override', async () => {
    const harness = createHarness({ getActiveScheme: reviewedDeliveryScheme });
    const result = await executeTool(harness.startTool, {
      task: 'implement the endpoint',
      role: 'worker',
      deliveryIntent: 'integrate',
      applyPolicy: 'auto',
    });
    expect(result.ok).toBe(true);
    const task = harness.batches[0]?.tasks[0];
    expect(task?.role).toBe('worker');
    expect(task?.deliveryIntent).toBe('candidate');
    expect(task?.applyPolicy).toBe('explicit');
  });

  it('leaves Off spawns unwrapped', async () => {
    const harness = createHarness();
    const result = await executeTool(harness.startTool, {
      task: 'fix the flake',
    });
    expect(result.ok).toBe(true);
    const task = harness.batches[0]?.tasks[0];
    expect(task?.task).toBe('fix the flake');
    expect(task?.task).not.toContain(PIWIN_FUSION_BRIEF_MARKER);
    expect(task?.retainWorktree).toBeUndefined();
  });
});

function autoScheme(): ResolvedOrchestrationScheme {
  const resolved = resolveOrchestrationScheme(
    { maxConcurrency: 4, maxTasksPerRun: 8 },
    AUTO_SCHEME_ID,
    { knownProfileIds: ['explorer', 'implementer', 'reviewer', 'tester'] },
  );
  if (!resolved) throw new Error('expected builtin auto scheme');
  return resolved;
}

describe('piwin_subagent_start detached tester', () => {
  it('starts the tester outside the parent run on a workspace snapshot', async () => {
    const registry = new DetachedSubagentRegistry();
    const settled: Array<{ runId: string; schemeId?: string }> = [];
    const harness = createHarness({
      getActiveScheme: autoScheme,
      detachedRegistry: registry,
      onDetachedBatchSettled: (input) => settled.push(input),
    });
    const result = await executeTool(harness.startTool, {
      task: 'verify the login button works',
      role: 'tester',
    });
    expect(result.ok).toBe(true);
    const task = harness.batches[0]?.tasks[0];
    expect(task).toMatchObject({
      role: 'tester',
      isolationOverride: 'worktree',
      deliveryIntent: 'candidate',
      applyPolicy: 'explicit',
      workspaceSnapshot: true,
    });
    expect(harness.batchParentRunIds[0]).toBeUndefined();
    const runId = registry.running(SESSION_ID);
    expect(runId).toBeDefined();
    if (!runId) throw new Error('expected a registered tester');
    await harness.orchestrator.joinBatch(runId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toEqual([expect.objectContaining({ runId, schemeId: 'auto' })]);
    expect(registry.running(SESSION_ID)).toBeUndefined();
  });

  it('keeps the tester when the parent run is cancelled, and refuses to wait on it', async () => {
    const registry = new DetachedSubagentRegistry();
    const harness = createHarness({ getActiveScheme: autoScheme, detachedRegistry: registry });
    await executeTool(harness.startTool, { task: 'verify', role: 'tester' });
    const runId = registry.running(SESSION_ID);
    if (!runId) throw new Error('expected a registered tester');
    harness.orchestrator.cancelBatchesForParentRun(PARENT_RUN_ID);
    expect(harness.orchestrator.isRunning(runId) || registry.running(SESSION_ID) === undefined).toBe(
      true,
    );
    await expect(
      harness.seam.wait?.({ runIds: [runId], parentSessionId: SESSION_ID, parentRunId: PARENT_RUN_ID }),
    ).rejects.toThrow(/detached tester/);
  });

  it('lets a later turn cancel the detached tester', async () => {
    const registry = new DetachedSubagentRegistry();
    const harness = createHarness({ getActiveScheme: autoScheme, detachedRegistry: registry });
    await executeTool(harness.startTool, { task: 'verify', role: 'tester' });
    const runId = registry.running(SESSION_ID);
    if (!runId) throw new Error('expected a registered tester');
    // The manifest records the run that started the tester; a later run must still be allowed.
    expect(harness.batches[0]?.tasks[0]?.parentRunId).toBe(PARENT_RUN_ID);
    const cancelled = await harness.seam.cancel?.({
      runIds: [runId],
      parentSessionId: SESSION_ID,
      parentRunId: 'a-later-run',
    });
    expect(cancelled?.runs[0]?.runId).toBe(runId);
  });

  it('runs scouts and the sidekick inside the parent run as before', async () => {
    const registry = new DetachedSubagentRegistry();
    const harness = createHarness({ getActiveScheme: autoScheme, detachedRegistry: registry });
    await executeTool(harness.startTool, { task: 'find the handler', role: 'scout' });
    expect(harness.batchParentRunIds[0]).toBe(PARENT_RUN_ID);
    expect(harness.batches[0]?.tasks[0]?.workspaceSnapshot).toBeUndefined();
    expect(registry.running(SESSION_ID)).toBeUndefined();
  });
});

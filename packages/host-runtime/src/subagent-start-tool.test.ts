import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  HostToolRegistration,
  SubagentBatchRequest,
  SubagentResultSummary,
  SubagentTaskResult,
  ToolResult,
} from '@piwin/contracts';
import { emptySubagentResultReviewFields } from '@piwin/contracts';
import { RunRegistry } from './run-registry.js';
import { TurnScopedSchemeAdmissionGate } from './orchestration-scheme-admission.js';
import { createSubagentControlSeam } from './host-runtime-subagent-start.js';
import { createSubagentStartTool } from './subagent-start-tool.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { bindSubagentReviewTarget } from './subagent-review-context.js';

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

function createHarness(options?: { summary?: SubagentResultSummary | undefined }) {
  const batches: SubagentBatchRequest[] = [];
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
      async acquire() {
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
      getActiveScheme: () => undefined,
      prepareBatch: async (request) => request,
      whenReady: async () => {},
      taskResults: new Map(),
      bindReviewTarget: (input) =>
        bindSubagentReviewTarget({
          ...input,
          getResult: () => summary,
        }),
      merge: async () => ({}),
    },
    SESSION_ID,
  );
  return {
    batches,
    startTool: createSubagentStartTool({ sessionId: SESSION_ID, seam }),
  };
}

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

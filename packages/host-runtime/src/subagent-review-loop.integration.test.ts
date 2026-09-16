/**
 * In-process Host reviewed-delivery loop. Fake child runners; no real models.
 * Covers plan §9.1 plus compact §9.2 / §9.3 / §9.6. Does not add tools.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  HostToolRegistration,
  SubagentBatchRequest,
  SubagentResultRef,
  SubagentReviewDecision,
  SubagentReviewRef,
  SubagentTaskResult,
  SubagentTaskRunInput,
  SubagentWorkspaceLease,
  ToolResult,
} from '@piwin/contracts';
import { resolveOrchestrationScheme } from '@piwin/contracts';
import {
  integrateWorktreeChanges,
  isWorktreeBaseClean,
  openTurnChangeStore,
  removeWorktree,
  runGitCommand,
} from '@piwin/git';
import { createSessionRecord, createSubagentRunStore, getSessionRecord, upsertSessionRecord } from '@piwin/session';
import {
  createGitWorktreeIntegrationAdapter,
  createSubagentIntegrationCoordinator,
} from './subagent-integration-coordinator.js';
import { TurnScopedSchemeAdmissionGate } from './orchestration-scheme-admission.js';
import { createSubagentControlSeam, type SubagentControlDeps } from './host-runtime-subagent-start.js';
import { prepareRetainedSubagentContinuation } from './subagent-continuation-prep.js';
import { createReviewedContinueGate, startReviewedContinuation } from './subagent-continue.js';
import { createSubagentContinueTool } from './subagent-continue-tool.js';
import { createSubagentResultApplyTool } from './subagent-result-apply-tool.js';
import { applyReviewedSubagentResult } from './subagent-result-apply.js';
import { applyStatusFromIntegration } from './subagent-apply-reservation.js';
import { freezeSubagentChildResult } from './subagent-result-freeze.js';
import {
  enrichSubagentTaskResult,
  projectSubagentResultSummary,
} from './subagent-result-projection.js';
import { createSubagentResultService } from './subagent-result-service.js';
import {
  createSubagentReviewService,
  findPersistedReview,
  loadPersistedReviewObservation,
} from './subagent-review-service.js';
import { createSubagentReviewSubmitTool } from './subagent-review-submit-tool.js';
import { bindSubagentReviewTarget, reviewScopeFromTarget } from './subagent-review-context.js';
import { createSubagentStartTool } from './subagent-start-tool.js';
import { createSubagentVerificationSubmitTool } from './subagent-verification-submit-tool.js';
import { createSubagentVerificationService } from './subagent-verification-service.js';
import { createSubagentWaitTool } from './subagent-wait-tool.js';
import { createSubagentWorkspaceService } from './subagent-workspace-service.js';
import { getPiwinSessionIndexPath } from './paths.js';
import { RunRegistry } from './run-registry.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import type { SubagentRunSeam, SubagentWaitRunObservation } from './subagent-run-tool.js';

const SESSION_ID = 'parent-1';
const PARENT_RUN_ID = 'run-1';
const SEED = 'export const login = () => null;\n';
const V1 = 'export const login = (token) => token;\n';
const V2 = 'export const login = (token) => { if (!token) throw new Error("auth"); return token; };\n';
const FINDING = {
  id: 'f-auth',
  severity: 'high' as const,
  title: 'Missing auth check',
  detail: 'Login returns the token without a session guard.',
};

const dirs: string[] = [];

type ReviewerScript = 'changes-requested' | 'approved' | 'prose';

async function git(cwd: string, args: string[]): Promise<string> {
  return (await runGitCommand({ cwd, args })).stdout.trim();
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

function requireOk(result: ToolResult, label: string): Extract<ToolResult, { ok: true }> {
  if (!result.ok) throw new Error(`${label}: ${result.code} ${result.message}`);
  return result;
}

function waitRun(result: ToolResult): SubagentWaitRunObservation {
  const ok = requireOk(result, 'wait');
  const runs = ok.details?.runs;
  if (!Array.isArray(runs) || runs[0] === undefined) {
    throw new Error('wait details.runs missing');
  }
  return runs[0] as SubagentWaitRunObservation;
}

function requireRef(ref: SubagentResultRef | undefined): SubagentResultRef {
  if (!ref) throw new Error('expected resultRef');
  return ref;
}

async function createHarness(scripts: ReviewerScript[]) {
  const root = await mkdtemp(join(tmpdir(), 'piwin-review-loop-'));
  dirs.push(root);
  const projectPath = join(root, 'project');
  const piwinRoot = join(root, 'piwin');
  await mkdir(projectPath, { recursive: true });
  await git(projectPath, ['init', '-b', 'main']);
  await git(projectPath, ['config', 'user.email', 'piwin-test@example.com']);
  await git(projectPath, ['config', 'user.name', 'piwin test']);
  await writeFile(join(projectPath, 'README.md'), 'login helper\n');
  await writeFile(join(projectPath, 'login.js'), SEED);
  await git(projectPath, ['add', '--all']);
  await git(projectPath, ['commit', '-m', 'seed']);

  const indexPath = getPiwinSessionIndexPath(piwinRoot);
  await upsertSessionRecord(
    indexPath,
    createSessionRecord({ id: SESSION_ID, projectPath, kind: 'main', name: 'parent' }),
  );

  const runStore = createSubagentRunStore({ runsDir: join(piwinRoot, 'subagent-runs') });
  const changeStore = openTurnChangeStore({ rootDir: join(piwinRoot, 'turn-changes') });
  const resultService = createSubagentResultService({
    changeStore,
    operationStore: changeStore,
  });
  const reviewService = createSubagentReviewService({ runStore, resultService });
  const latestWorktree = new Map<
    string,
    { result: SubagentTaskResult; lease: Extract<SubagentWorkspaceLease, { mode: 'worktree' }> }
  >();
  const reviewerScripts = [...scripts];

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

  const coordinator = createSubagentIntegrationCoordinator({
    integrateWorktree: createGitWorktreeIntegrationAdapter(integrateWorktreeChanges),
    isBaseClean: isWorktreeBaseClean,
    removeWorktree: async (worktreePath, parentRepoPath, worktreeBranch) => {
      await removeWorktree({
        projectPath: parentRepoPath,
        worktreePath,
        force: true,
        ...(worktreeBranch ? { worktreeBranch } : {}),
      });
    },
  });

  const orchestrator = new SubagentOrchestrator({
    taskRunner: {
      capabilities: { processIsolation: true },
      async runTask(input: SubagentTaskRunInput) {
        const { task, workspaceLease, childSessionId } = input;
        if (task.reviewTarget) {
          await readFile(join(workspaceLease.cwd, 'README.md'), 'utf8');
          await readFile(join(workspaceLease.cwd, 'login.js'), 'utf8');
          const script = reviewerScripts.shift() ?? 'prose';
          if (script !== 'prose') {
            const submitted = await createSubagentReviewSubmitTool({
              scope: reviewScopeFromTarget(task.reviewTarget),
              reviewerSessionId: childSessionId,
              ...(task.invocationId ? { invocationId: task.invocationId } : {}),
              service: reviewService,
            }).execute(
              {
                target: task.reviewTarget.result,
                decision: script,
                findings: script === 'changes-requested' ? [FINDING] : [],
                verification: [],
              },
              new AbortController().signal,
              {
                sessionId: childSessionId,
                runtimeGenerationId: 'generation-1',
                runId: input.taskRunId,
                toolName: 'piwin_subagent_review_submit',
              },
            );
            if (!submitted.ok) {
              throw new Error(`review submit: ${submitted.code} ${submitted.message}`);
            }
          }
          return {
            executionStatus: 'completed' as const,
            summaryStatus: 'merged' as const,
            integrationStatus: 'not-requested' as const,
            childSessionId,
            summaryPreview: script === 'prose' ? 'Looks fine in prose.' : script,
          };
        }
        const body = task.predecessorResult || (task.candidateGeneration ?? 1) > 1 ? V2 : V1;
        await writeFile(join(workspaceLease.cwd, 'login.js'), body);
        return {
          executionStatus: 'completed' as const,
          summaryStatus: 'merged' as const,
          integrationStatus: 'not-requested' as const,
          childSessionId,
          changedFiles: ['login.js'],
          summaryPreview: body === V2 ? 'repaired login' : 'candidate login',
        };
      },
    },
    workspaceService: createSubagentWorkspaceService({
      projectPath,
      worktreeStorageRoot: join(piwinRoot, 'worktrees'),
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    }),
    prepareTask: async (input) => ({
      runtimeSnapshot: {
        isolation: input.workspaceLease.mode,
        workingDirectory: input.workspaceLease.cwd,
      },
      sessionBlueprint: {
        version: 1 as const,
        sessionId: input.childSessionId,
        runtimeGenerationId: input.runtimeGenerationId,
        capabilitySnapshot: {
          version: 1 as const,
          snapshotId: `snap-${input.childSessionId}`,
          inputs: {
            rulesRevision: 'r',
            settingsRevision: 's',
            projectRevision: 'p',
            mcpRevision: 'm',
            resourceCatalogRevision: 'c',
          },
          scope: { kind: 'general' as const },
          workingDirectory: input.workspaceLease.cwd,
          trust: { kind: 'general' as const },
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
    integrationCoordinator: coordinator,
    freezeChildResult: ({ result, lease }) => freezeSubagentChildResult({ store: changeStore, result, lease }),
    runRegistry,
    runStore,
    push: () => {},
    getRuntimeGenerationId: () => 'generation-1',
    registerTaskSession: async (input) => {
      const lease = input.workspaceLease;
      await upsertSessionRecord(
        indexPath,
        createSessionRecord({
          id: input.childSessionId,
          projectPath,
          parentSessionId: input.parentSessionId,
          kind: 'subagent',
          name: input.task.sessionName ?? `subagent-${input.task.id}`,
          subagentStatus: 'running',
          task: input.task.task,
          ...(input.task.invocationId ? { subagentInvocationId: input.task.invocationId } : {}),
          subagentTaskId: input.task.id,
          subagentMode: lease.mode,
          subagentApplyPolicy: input.task.applyPolicy ?? 'none',
          subagentRetainWorktree: input.task.retainWorktree === true,
          ...(input.task.role ? { subagentRole: input.task.role } : {}),
          ...(lease.mode === 'worktree'
            ? { worktreePath: lease.worktreePath, worktreeBranch: lease.worktreeBranch }
            : {}),
          subagentRuntime: {
            isolation: lease.mode,
            workingDirectory: input.workingDirectory,
            ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
            ...(input.task.model ? { model: input.task.model } : {}),
          },
          subagentLifecycle: {
            executionStatus: 'running',
            summaryStatus: 'not-requested',
            integrationStatus: lease.mode === 'worktree' ? 'pending' : 'not-requested',
          },
        }),
      );
    },
    onTaskResult: async ({ result }) => {
      const manifest = await runStore.loadManifest(result.runId);
      const task = manifest?.tasks.find((candidate) => candidate.id === result.taskId);
      const lease = manifest?.leases[result.taskId];
      const summary = projectSubagentResultSummary({
        parentSessionId: SESSION_ID,
        result,
        task,
        lease,
      });
      if (summary) {
        resultService.register(
          summary,
          result.worktreePath ? { worktreePath: result.worktreePath } : undefined,
        );
        await runStore.recordResult(
          result.runId,
          result.taskId,
          enrichSubagentTaskResult(result, resultService.get(summary.resultId) ?? summary, task),
        );
      }
      if (result.childSessionId) {
        const child = await getSessionRecord(indexPath, result.childSessionId);
        if (child) {
          child.subagentStatus = 'done';
          child.subagentLifecycle = {
            executionStatus: result.executionStatus,
            summaryStatus: result.summaryStatus,
            integrationStatus: result.integrationStatus,
          };
          await upsertSessionRecord(indexPath, child);
        }
      }
      if (result.childSessionId && lease?.mode === 'worktree') {
        latestWorktree.set(result.childSessionId, { result, lease });
      }
    },
  });

  const scheme = resolveOrchestrationScheme({}, 'reviewed-delivery');
  const schemeAdmissionGate = new TurnScopedSchemeAdmissionGate();
  schemeAdmissionGate.bind(parentRun.runId, { maxConcurrency: 8, maxTasksPerRun: 8 });
  const controlDeps: SubagentControlDeps = {
    orchestrator,
    schemeAdmissionGate,
    runRegistry,
    getParentRunId: () => parentRun.runId,
    getDelegationMode: () => 'auto',
    getActiveScheme: () => scheme,
    prepareBatch: async (request: SubagentBatchRequest) => ({
      ...request,
      tasks: request.tasks.map((task) => ({
        ...task,
        retainWorktree: task.isolationOverride === 'worktree' || task.retainWorktree === true,
        ...(task.isolationOverride === 'worktree'
          ? {
              deliveryIntent: task.deliveryIntent ?? 'candidate',
              applyPolicy: task.applyPolicy ?? 'explicit',
            }
          : {}),
      })),
    }),
    whenReady: async () => {},
    taskResults: new Map(),
    bindReviewTarget: (input) =>
      bindSubagentReviewTarget({
        ...input,
        getResult: (resultId) => resultService.get(resultId),
        hasFrozenChanges: (changes) =>
          changeStore.getChangeVersion(changes.changeSetId, changes.revision) !== undefined,
      }),
    merge: async () => ({}),
    observePersistedReview: (runId) => loadPersistedReviewObservation(runStore, runId),
  };
  const baseSeam = createSubagentControlSeam(controlDeps, SESSION_ID);
  const seam: SubagentRunSeam = {
    ...baseSeam,
    continueReviewed: (input) =>
      startReviewedContinuation(
        {
          ...controlDeps,
          prepareContinuation: (childSessionId) =>
            prepareRetainedSubagentContinuation(
              {
                options: { piwinRoot },
                resolveRetainedSubagentWorktreeLease: async (child) => {
                  if (!child.worktreePath) {
                    throw new Error('subagent worktree is no longer retained');
                  }
                  const manifests = await runStore.listManifests();
                  const lease = manifests
                    .flatMap((manifest) =>
                      manifest.tasks.flatMap((task) => {
                        const stored = manifest.results[task.id];
                        const taskLease = manifest.leases[task.id];
                        return stored?.childSessionId === child.id &&
                          taskLease?.mode === 'worktree' &&
                          taskLease.worktreePath === child.worktreePath
                          ? [taskLease]
                          : [];
                      }),
                    )
                    .at(-1);
                  if (!lease) {
                    throw new Error('subagent worktree lease is unavailable');
                  }
                  return lease;
                },
              },
              childSessionId,
            ),
          getResult: (resultId) => resultService.get(resultId),
          listResults: (parentSessionId) => resultService.list({ parentSessionId }).items,
          loadReview: (ref) => findPersistedReview(runStore, ref),
          isAdmissionClosed: (runId) => runRegistry.isAdmissionClosed(runId),
          continueGate: createReviewedContinueGate(),
        },
        SESSION_ID,
        input,
      ),
    applyReviewed: async (input) =>
      applyReviewedSubagentResult(
        {
          resultService,
          loadReview: (ref) => findPersistedReview(runStore, ref),
          applyResult: async (applyInput) => {
            const summary = resultService.get(applyInput.resultId);
            const latest = summary?.childSessionId
              ? latestWorktree.get(summary.childSessionId)
              : undefined;
            if (!latest) throw new Error(`worktree result not found: ${applyInput.resultId}`);
            const integrated = await coordinator.integrate(latest.result, latest.lease);
            return {
              operationId: applyInput.operationId,
              status: applyStatusFromIntegration({
                integrationStatus: integrated.integrationStatus,
              }),
              integrationStatus: integrated.integrationStatus,
            };
          },
          persistApply: async (persist) => {
            await runStore.projectResultApply(persist.batchRunId, persist.taskId, {
              appliedChanges: persist.appliedChanges,
              latestOperationId: persist.latestOperationId,
            });
          },
        },
        {
          parentSessionId: SESSION_ID,
          result: input.result,
          approvedBy: input.approvedBy,
        },
      ),
    submitVerification: (input) =>
      createSubagentVerificationService({ runStore, resultService }).submit({
        parentSessionId: SESSION_ID,
        parentRunId: input.parentRunId,
        result: input.result,
        approvedBy: input.approvedBy,
        applyOperationId: input.applyOperationId,
        status: input.status,
        checks: input.checks,
      }),
  };

  return {
    projectPath,
    changeStore,
    resultService,
    runStore,
    start: createSubagentStartTool({ sessionId: SESSION_ID, seam }),
    wait: createSubagentWaitTool({ sessionId: SESSION_ID, seam }),
    continueTool: createSubagentContinueTool({ sessionId: SESSION_ID, seam }),
    apply: createSubagentResultApplyTool({ sessionId: SESSION_ID, seam, workspacePath: projectPath }),
    verify: createSubagentVerificationSubmitTool({ sessionId: SESSION_ID, seam }),
    parentLogin: () => readFile(join(projectPath, 'login.js'), 'utf8'),
  };
}

async function startWorker(harness: Awaited<ReturnType<typeof createHarness>>): Promise<string> {
  const started = requireOk(
    await executeTool(harness.start, {
      task: 'Implement login. Acceptance: token is returned only after a session guard.',
      role: 'worker',
      mode: 'worktree',
      deliveryIntent: 'candidate',
      applyPolicy: 'explicit',
    }),
    'start worker',
  );
  return String(started.details?.runId ?? '');
}

async function startReviewer(
  harness: Awaited<ReturnType<typeof createHarness>>,
  reviewOf: SubagentResultRef,
): Promise<string> {
  const started = requireOk(
    await executeTool(harness.start, {
      task: 'Review the frozen login candidate. Acceptance: submit a structured decision.',
      role: 'reviewer',
      mode: 'readonly',
      reviewOf,
    }),
    'start reviewer',
  );
  return String(started.details?.runId ?? '');
}

async function waitFor(harness: Awaited<ReturnType<typeof createHarness>>, runId: string) {
  return waitRun(await executeTool(harness.wait, { runIds: [runId] }));
}

describe('reviewed-delivery Host loop', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('§9.1 worker v1 → CR → continue v2 → approve → apply v2 → passed verify', async () => {
    const harness = await createHarness(['changes-requested', 'approved']);
    const workerV1 = await waitFor(harness, await startWorker(harness));
    const v1 = requireRef(workerV1.resultRef);
    expect(workerV1.childChanges).toEqual({ changeSetId: v1.resultId, revision: 1 });
    expect(await harness.parentLogin()).toBe(SEED);

    const reviewA = await waitFor(harness, await startReviewer(harness, v1));
    expect(reviewA.reviewDecision).toBe('changes-requested');
    const reviewARef = reviewA.reviewRef;
    if (!reviewARef) throw new Error('reviewer A missing reviewRef');

    const continued = requireOk(
      await executeTool(harness.continueTool, {
        childSessionId: workerV1.childSessionId,
        expectedResult: v1,
        review: reviewARef,
        task: 'Add the session guard from the Host findings.',
      }),
      'continue',
    );
    const workerV2 = await waitFor(harness, String(continued.details?.runId ?? ''));
    const v2 = requireRef(workerV2.resultRef);
    expect(v2.resultId).not.toBe(v1.resultId);
    expect(workerV2.childSessionId).toBe(workerV1.childSessionId);
    expect(await harness.parentLogin()).toBe(SEED);

    const reviewB = await waitFor(harness, await startReviewer(harness, v2));
    expect(reviewB.reviewDecision).toBe('approved');
    const reviewBRef = reviewB.reviewRef;
    if (!reviewBRef) throw new Error('reviewer B missing reviewRef');

    const applied = requireOk(
      await executeTool(harness.apply, { result: v2, approvedBy: reviewBRef }),
      'apply v2',
    );
    expect(applied.details?.integrationStatus).toBe('applied');
    expect(await harness.parentLogin()).toBe(V2);
    expect(harness.resultService.get(v1.resultId)?.integrationStatus).not.toBe('applied');

    const verified = requireOk(
      await executeTool(harness.verify, {
        result: applied.details?.result ?? v2,
        approvedBy: reviewBRef,
        applyOperationId: applied.details?.operationId,
        status: 'passed',
        checks: [{ label: 'login-guard', status: 'passed', evidence: 'token is rejected when missing' }],
      }),
      'verify',
    );
    expect(verified.details?.status).toBe('passed');

    const summaryV1 = harness.resultService.get(v1.resultId);
    const summaryV2 = harness.resultService.get(v2.resultId);
    expect(summaryV1?.candidateLineageId).toBe(v1.resultId);
    expect(summaryV1?.candidateLineageId).toBe(summaryV2?.candidateLineageId);
    expect(summaryV1?.candidateGeneration).toBe(1);
    expect(summaryV2?.candidateGeneration).toBe(2);
    expect(summaryV2?.predecessorResult).toEqual(v1);
    expect(summaryV2?.integrationStatus).toBe('applied');
    expect(summaryV2?.latestVerification).toEqual(verified.details?.verificationRef);
    expect(summaryV1?.integrationStatus).toBe('retained');

    const manifests = await harness.runStore.listManifests();
    const workerRuns = manifests.filter((manifest) =>
      manifest.tasks.some((task) => task.deliveryIntent === 'candidate'),
    );
    const reviewerSessions = new Set(
      manifests.flatMap((manifest) =>
        manifest.tasks
          .filter((task) => task.role === 'reviewer')
          .map((task) => manifest.results[task.id]?.childSessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const worktrees = new Set(
      manifests.flatMap((manifest) =>
        Object.values(manifest.leases)
          .filter((lease): lease is Extract<SubagentWorkspaceLease, { mode: 'worktree' }> =>
            lease.mode === 'worktree',
          )
          .map((lease) => lease.worktreePath),
      ),
    );
    expect(workerRuns).toHaveLength(2);
    expect(new Set(workerRuns.flatMap((manifest) =>
      Object.values(manifest.results).map((result) => result.childSessionId),
    ))).toEqual(new Set([workerV1.childSessionId]));
    expect(reviewerSessions.size).toBe(2);
    expect(worktrees.size).toBe(1);
    expect(manifests.filter((manifest) =>
      Object.values(manifest.results).some((result) => result.deliveryVerification),
    )).toHaveLength(1);
    harness.changeStore.close();
  });

  it('§9.2 stale v1 approval cannot apply after v2', async () => {
    const harness = await createHarness(['approved', 'changes-requested']);
    const workerV1 = await waitFor(harness, await startWorker(harness));
    const v1 = requireRef(workerV1.resultRef);
    const approved = await waitFor(harness, await startReviewer(harness, v1));
    const approvedRef = approved.reviewRef as SubagentReviewRef;
    expect(approved.reviewDecision).toBe<SubagentReviewDecision>('approved');
    const cr = await waitFor(harness, await startReviewer(harness, v1));
    const continued = requireOk(
      await executeTool(harness.continueTool, {
        childSessionId: workerV1.childSessionId,
        expectedResult: v1,
        review: cr.reviewRef,
        task: 'Repair from the replacement review.',
      }),
      'continue after replacement CR',
    );
    const workerV2 = await waitFor(harness, String(continued.details?.runId ?? ''));
    const v2 = requireRef(workerV2.resultRef);
    expect(
      await executeTool(harness.apply, { result: v1, approvedBy: approvedRef }),
    ).toMatchObject({ ok: false, code: 'candidate-superseded' });
    expect(
      await executeTool(harness.apply, { result: v2, approvedBy: approvedRef }),
    ).toMatchObject({ ok: false, code: 'stale-review' });
    expect(await harness.parentLogin()).toBe(SEED);
    harness.changeStore.close();
  });

  it('§9.3 reviewer prose-only → review-missing, apply refused', async () => {
    const harness = await createHarness(['prose']);
    const workerV1 = await waitFor(harness, await startWorker(harness));
    const v1 = requireRef(workerV1.resultRef);
    const review = await waitFor(harness, await startReviewer(harness, v1));
    expect(review.executionStatus).toBe('completed');
    expect(review.reviewRef).toBeUndefined();
    expect(review.reviewDecision).toBeUndefined();
    expect(
      await executeTool(harness.apply, {
        result: v1,
        approvedBy: { reviewId: 'missing', revision: 1 },
      }),
    ).toMatchObject({ ok: false, code: 'review-missing' });
    expect(await harness.parentLogin()).toBe(SEED);
    harness.changeStore.close();
  });

  it('§9.6 failed verification after apply: still applied, not delivered, no undo', async () => {
    const harness = await createHarness(['approved']);
    const workerV1 = await waitFor(harness, await startWorker(harness));
    const v1 = requireRef(workerV1.resultRef);
    const review = await waitFor(harness, await startReviewer(harness, v1));
    const applied = requireOk(
      await executeTool(harness.apply, { result: v1, approvedBy: review.reviewRef }),
      'apply v1',
    );
    expect(applied.details?.integrationStatus).toBe('applied');
    expect(await harness.parentLogin()).toBe(V1);
    const verified = requireOk(
      await executeTool(harness.verify, {
        result: applied.details?.result ?? v1,
        approvedBy: review.reviewRef,
        applyOperationId: applied.details?.operationId,
        status: 'failed',
        checks: [{ label: 'login-guard', status: 'failed', evidence: 'token still accepted without guard' }],
      }),
      'failed verify',
    );
    expect(verified.details?.status).toBe('failed');
    const summary = harness.resultService.get(v1.resultId);
    expect(summary?.integrationStatus).toBe('applied');
    expect(summary?.latestVerification).toEqual(verified.details?.verificationRef);
    expect(await harness.parentLogin()).toBe(V1);
    harness.changeStore.close();
  });
});

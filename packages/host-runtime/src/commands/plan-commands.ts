/**
 * Host IPC handlers: plan.
 */
import type { HostCommand, HostResponse, PlanExecutionState, SessionPlan } from '@piwin/contracts'
import { formatError } from '@piwin/contracts';;
import {
  applyPlanStatus,
  applyPlanStepUpdate,
  clearSessionPlan,
  getSessionRecord,
  loadSessionPlan,
  saveSessionPlan,
  validateSessionPlan,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { getPiwinRoot, getPiwinSessionIndexPath, getPiwinSessionPlanPath } from '../paths.js';
import type { HostCommandContext } from './host-command-context.js';
import {
  abortExecutionState,
  buildInlineDirective,
  buildPlanSubagentTask,
  buildPlanSummary,
  buildSubagentVerificationDirective,
  completeExecutionState,
  createExecutionState,
  failExecutionState,
  selectSubagentSteps,
} from '../plan-execution-coordinator.js';
import { startWalkthroughGeneration } from './walkthrough-commands.js';
import { resolveConfiguredDefaultModelRef, findEnabledProvider } from '../provider-helpers.js';
import { createDefaultWalkthroughConfig } from '@piwin/contracts';

const TYPES = new Set<HostCommand['type']>([
  'plan/get',
  'plan/set',
  'plan/clear',
  'plan/approve',
  'plan/update-step',
  'plan/set-status',
  'plan/execute',
  'plan/abort',
]);

/** In-process cancellation intent closes execution mutation races before disk I/O resumes. */
const activePlanAbortIntents = new Set<string>();

function planAbortIntentKey(planPath: string, planId: string): string {
  return `${planPath}:${planId}`;
}

export function isPlanCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handlePlanCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
    case 'plan/get': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
      const plan = await loadSessionPlan(planPath);
      return ok(requestId, 'plan/get', { sessionId: command.sessionId, plan });
    }
    case 'plan/set': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const existing = await getSessionRecord(getPiwinSessionIndexPath(rootDir), command.sessionId);
      if (!existing) {
        return fail(requestId, 'plan/set', `Unknown session: ${command.sessionId}`);
      }
      const validated = validateSessionPlan(command.plan);
      if (!validated.ok) {
        return fail(
          requestId,
          'plan/set',
          validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
        );
      }
      const now = new Date().toISOString();
      const previous = await loadSessionPlan(getPiwinSessionPlanPath(rootDir, command.sessionId));
      const plan = {
        ...validated.plan,
        sessionId: command.sessionId,
        projectPath: existing.projectPath,
        id: previous?.id ?? validated.plan.id,
        createdAt: previous?.createdAt ?? validated.plan.createdAt ?? now,
        updatedAt: now,
        revision: previous ? previous.revision + 1 : validated.plan.revision,
      };
      await saveSessionPlan(getPiwinSessionPlanPath(rootDir, command.sessionId), plan);
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan });
      return ok(requestId, 'plan/set', { plan });
    }
    case 'plan/clear': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      await clearSessionPlan(getPiwinSessionPlanPath(rootDir, command.sessionId));
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: null });
      return ok(requestId, 'plan/clear', { sessionId: command.sessionId });
    }
    case 'plan/approve': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
      const plan = await loadSessionPlan(planPath);
      if (!plan) {
        return fail(requestId, 'plan/approve', 'No plan for session');
      }
      if (plan.status !== 'draft' && plan.status !== 'approved') {
        return fail(requestId, 'plan/approve', `Cannot approve plan in status ${plan.status}`);
      }
      const approved = {
        ...plan,
        status: 'approved' as const,
        revision: plan.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await saveSessionPlan(planPath, approved);
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: approved });
      return ok(requestId, 'plan/approve', { plan: approved });
    }
    case 'plan/update-step': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
      const plan = await loadSessionPlan(planPath);
      if (!plan) {
        return fail(requestId, 'plan/update-step', 'No plan for session');
      }
      const result = applyPlanStepUpdate({
        plan,
        stepId: command.stepId,
        status: command.status,
        ...(typeof command.detail === 'string' ? { detail: command.detail } : {}),
      });
      if (!result.ok) {
        return fail(requestId, 'plan/update-step', result.error);
      }
      await saveSessionPlan(planPath, result.plan);
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: result.plan });
      if (result.plan.status !== plan.status) {
        context.push({
          type: 'host/log',
          level: 'info',
          message: `plan ${command.sessionId} status ${plan.status} → ${result.plan.status}`,
        });
      }
      return ok(requestId, 'plan/update-step', { plan: result.plan });
    }
    case 'plan/set-status': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
      const plan = await loadSessionPlan(planPath);
      if (!plan) {
        return fail(requestId, 'plan/set-status', 'No plan for session');
      }
      const result = applyPlanStatus({ plan, status: command.status });
      if (!result.ok) {
        return fail(requestId, 'plan/set-status', result.error);
      }
      await saveSessionPlan(planPath, result.plan);
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: result.plan });
      return ok(requestId, 'plan/set-status', { plan: result.plan });
    }
    case 'plan/execute': {
      return handlePlanExecute(command, requestId, context);
    }
    case 'plan/abort': {
      return handlePlanAbort(command, requestId, context);
    }

    default:
      return null;
  }
}

async function handlePlanExecute(
  command: Extract<HostCommand, { type: 'plan/execute' }>,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse> {
  const seam = context.planExecution;
  if (!seam) {
    return fail(requestId, 'plan/execute', 'plan execution is not available in this host mode');
  }
  const rootDir = getPiwinRoot(context.piwinRoot);
  const planPath = getPiwinSessionPlanPath(rootDir, command.request.sessionId);
  const plan = await loadSessionPlan(planPath);
  if (!plan) {
    return fail(requestId, 'plan/execute', 'No plan for session');
  }
  if (plan.id !== command.request.planId) {
    return fail(
      requestId,
      'plan/execute',
      `plan id mismatch: requested ${command.request.planId} but session has ${plan.id}`,
    );
  }
  if (
    command.request.expectedRevision !== undefined &&
    plan.revision !== command.request.expectedRevision
  ) {
    return fail(
      requestId,
      'plan/execute',
      `plan revision mismatch: requested ${command.request.expectedRevision} but session has ${plan.revision}`,
    );
  }
  const canAtomicallyApproveDraft = plan.status === 'draft' && command.request.approveDraft === true;
  if (plan.status !== 'approved' && plan.status !== 'executing' && !canAtomicallyApproveDraft) {
    return fail(
      requestId,
      'plan/execute',
      `plan must be approved before execution or explicitly approved atomically (current status: ${plan.status})`,
    );
  }
  if (
    plan.execution &&
    (plan.execution.status === 'running' || plan.execution.status === 'queued')
  ) {
    return fail(
      requestId,
      'plan/execute',
      `plan is already ${plan.execution.status} with mode ${plan.execution.mode}`,
    );
  }

  const planRun = seam.startPlanRun?.(command.request.sessionId, plan.id);
  if (!planRun) {
    return fail(requestId, 'plan/execute', 'plan execution Run authority is unavailable');
  }

  let state: PlanExecutionState = {
    ...createExecutionState(plan, command.request.mode),
    runId: planRun.runId,
  };
  const executingPlan: SessionPlan = {
    ...plan,
    status: 'executing',
    execution: state,
    revision: plan.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await saveSessionPlan(planPath, executingPlan);
  context.push({ type: 'plan/updated', sessionId: command.request.sessionId, plan: executingPlan });
  context.push({ type: 'plan/execution-updated', state });

  // Detach the orchestration so the IPC call returns immediately. The UI
  // observes progress via plan/updated and plan/execution-updated pushes.
  void runPlanExecution(
    command.request.sessionId,
    plan,
    command.request.mode,
    seam,
    context,
    planRun.runId,
  ).catch(
    (error) => {
      const message = formatError(error);
      context.push({
        type: 'host/log',
        level: 'error',
        message: `plan execution failed unexpectedly: ${message}`,
      });
    },
  );

  return ok(requestId, 'plan/execute', {
    sessionId: command.request.sessionId,
    planId: plan.id,
    mode: command.request.mode,
    status: state.status,
    runId: planRun.runId,
  });
}

async function runPlanExecution(
  sessionId: string,
  plan: SessionPlan,
  mode: PlanExecutionState['mode'],
  seam: NonNullable<HostCommandContext['planExecution']>,
  context: HostCommandContext,
  planRunId: string,
): Promise<void> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const planPath = getPiwinSessionPlanPath(rootDir, sessionId);

  let state: PlanExecutionState = { ...createExecutionState(plan, mode), runId: planRunId };

  const markRunning = async (currentStepId?: string): Promise<PlanExecutionState> => {
    const current = await loadSessionPlan(planPath);
    if (!current || !current.execution) return state;
    if (
      current.execution.status === 'aborted' ||
      activePlanAbortIntents.has(planAbortIntentKey(planPath, current.id))
    ) {
      throw new Error('plan execution aborted');
    }
    state = { ...state, status: 'running', ...(currentStepId ? { currentStepId } : {}) };
    const updated: SessionPlan = {
      ...current,
      execution: state,
      updatedAt: new Date().toISOString(),
    };
    await saveSessionPlan(planPath, updated);
    context.push({ type: 'plan/updated', sessionId, plan: updated });
    context.push({ type: 'plan/execution-updated', state });
    return state;
  };

  const markFailed = async (error: string): Promise<void> => {
    const current = await loadSessionPlan(planPath);
    if (!current) return;
    if (
      current.execution?.status === 'aborted' ||
      activePlanAbortIntents.has(planAbortIntentKey(planPath, current.id))
    ) {
      context.planExecution?.finishPlanRun?.(planRunId, 'cancelled');
      return;
    }
    state = failExecutionState(state, error);
    const updated: SessionPlan = {
      ...current,
      execution: state,
      updatedAt: new Date().toISOString(),
    };
    await saveSessionPlan(planPath, updated);
    context.push({ type: 'plan/updated', sessionId, plan: updated });
    context.push({ type: 'plan/execution-updated', state });
    context.planExecution?.finishPlanRun?.(planRunId, 'failed', error);
  };

  const markCompleted = async (finalAssistantMessageId: string): Promise<void> => {
    const current = await loadSessionPlan(planPath);
    if (!current) return;
    if (
      current.execution?.status === 'aborted' ||
      activePlanAbortIntents.has(planAbortIntentKey(planPath, current.id))
    ) {
      context.planExecution?.finishPlanRun?.(planRunId, 'cancelled');
      return;
    }
    const completedState = completeExecutionState(state);
    const summary = buildPlanSummary({
      plan: { ...current, execution: completedState },
      mode,
      mergedChildSessionIds: completedState.childSessionIds,
      verificationResult: `Final assistant verification completed in message ${finalAssistantMessageId}`,
    });
    state = { ...completedState, summary };
    const finalPlan: SessionPlan = {
      ...current,
      status: 'done',
      execution: state,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await saveSessionPlan(planPath, finalPlan);
    context.push({ type: 'plan/updated', sessionId, plan: finalPlan });
    context.push({ type: 'plan/execution-updated', state });
    context.planExecution?.finishPlanRun?.(planRunId, 'completed');

    // Walkthrough is always generated when a plan completes.
    // Find the final assistant message and trigger generation.
    await triggerPlanCompletionWalkthrough(
      sessionId,
      finalPlan,
      finalAssistantMessageId,
      context,
    );
  };

  try {
    if (mode === 'inline') {
      await markRunning();
      const directive = buildInlineDirective(plan);
      const completion = await seam.promptSession(sessionId, directive.promptText, planRunId);
      const latest = await loadSessionPlan(planPath);
      if (
        latest &&
        latest.steps.every((step) => step.status === 'done' || step.status === 'skipped')
      ) {
        await markCompleted(completion.finalAssistantMessageId);
      } else {
        await markFailed('inline execution ended before all plan steps reached a terminal status');
      }
      return;
    }

    // subagent-driven
    const stepIds = selectSubagentSteps(plan);
    if (stepIds.length === 0) {
      // No independent steps declared — fall back to inline behavior in the
      // parent so the plan still progresses.
      await markRunning();
      const directive = buildInlineDirective(plan);
      const completion = await seam.promptSession(sessionId, directive.promptText, planRunId);
      const latest = await loadSessionPlan(planPath);
      if (
        latest &&
        latest.steps.every((step) => step.status === 'done' || step.status === 'skipped')
      ) {
        await markCompleted(completion.finalAssistantMessageId);
      } else {
        await markFailed('inline execution ended before all plan steps reached a terminal status');
      }
      return;
    }

    // CE-SUB-ORCH: route all subagent-driven plan execution through the
    // orchestrator. The sequential spawnSubagent fallback has been removed
    // (ADR 0030 Phase D).
    const childIds: string[] = [];
    await markRunning();
    const tasks = stepIds
      .map((stepId) => buildPlanSubagentTask(plan, stepId))
      .filter((task): task is NonNullable<typeof task> => task !== null);

    const batchResult = await seam.runBatch({
      parentSessionId: sessionId,
      tasks,
    }, planRunId);

    await seam.mergeBatchSummaries?.(sessionId, batchResult.results);

    // Record child session ids from successful results.
    for (const result of batchResult.results) {
      if (result.childSessionId) {
        childIds.push(result.childSessionId);
      }
    }
    state = { ...state, childSessionIds: [...state.childSessionIds, ...childIds] };
    const withChildren = await loadSessionPlan(planPath);
    if (withChildren) {
      const updated: SessionPlan = {
        ...withChildren,
        execution: state,
        updatedAt: new Date().toISOString(),
      };
      await saveSessionPlan(planPath, updated);
      context.push({ type: 'plan/updated', sessionId, plan: updated });
      context.push({ type: 'plan/execution-updated', state });
    }

    if (batchResult.status === 'cancelled') {
      // plan/abort owns the terminal plan transition. Do not let the async
      // execution owner overwrite an abandoned plan with a synthetic error.
      context.planExecution?.finishPlanRun?.(planRunId, 'cancelled');
      return;
    }
    if (batchResult.status !== 'completed') {
      await markFailed(`batch ${batchResult.status}`);
      return;
    }

    // Parent runs final verification and posts the walkthrough.
    await markRunning();
    const verifyDirective = buildSubagentVerificationDirective(plan, batchResult.results);
    const completion = await seam.promptSession(sessionId, verifyDirective.promptText, planRunId);

    const latest = await loadSessionPlan(planPath);
    if (
      latest &&
      latest.steps.every((step) => step.status === 'done' || step.status === 'skipped')
    ) {
      await markCompleted(completion.finalAssistantMessageId);
    } else {
      await markFailed('verification ended before all plan steps reached a terminal status');
    }
  } catch (error) {
    const message = formatError(error);
    await markFailed(message);
  }
}

/**
 * Trigger walkthrough generation after plan completion.
 * Finds the last assistant message in the transcript and starts a
 * fire-and-forget generation via the walkthrough command pipeline.
 */
async function triggerPlanCompletionWalkthrough(
  sessionId: string,
  plan: SessionPlan,
  finalAssistantMessageId: string,
  context: HostCommandContext,
): Promise<void> {
  const walkthroughBag = context.walkthrough;
  if (!walkthroughBag) return;

  try {
    const messages = await walkthroughBag.context.loadTranscriptMessages(sessionId);
    const config = await walkthroughBag.context.loadConfig();
    const walkthrough = config.walkthrough ?? createDefaultWalkthroughConfig();
    const targetMessage = messages.find((message) => message.id === finalAssistantMessageId);
    if (!targetMessage || targetMessage.role !== 'assistant' || targetMessage.status !== 'done') {
      throw new Error(
        `completed plan ${plan.id} has no durable final assistant message ${finalAssistantMessageId}`,
      );
    }

    // Resolve model: message snapshot → session model → config default.
    let model = targetMessage.model;
    if (!model) {
      model = walkthroughBag.context.resolveSessionModel(sessionId);
    }
    if (!model) {
      model = resolveConfiguredDefaultModelRef(config);
    }
    if (!model) {
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `plan walkthrough: no model available for session ${sessionId}, skipping generation`,
      });
      return;
    }

    const provider = findEnabledProvider(config, model.providerId);
    if (!provider) {
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `plan walkthrough: provider ${model.providerId} not found, skipping generation`,
      });
      return;
    }

    // Fire-and-forget: the generation runs asynchronously and pushes
    // walkthrough/updated events as it progresses.
    void startWalkthroughGeneration(
      sessionId,
      finalAssistantMessageId,
      model,
      provider,
      'default',
      walkthrough,
      targetMessage,
      messages,
      walkthroughBag.context,
      walkthroughBag.registry,
      undefined,
      plan.id,
    ).catch((error: unknown) => {
      const detail = formatError(error);
      context.push({
        type: 'host/log',
        level: 'error',
        message: `plan walkthrough generation failed: ${detail}`,
      });
    });
  } catch (error) {
    const detail = formatError(error);
    context.push({
      type: 'host/log',
      level: 'error',
      message: `plan walkthrough trigger failed: ${detail}`,
    });
  }
}

async function handlePlanAbort(
  command: Extract<HostCommand, { type: 'plan/abort' }>,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
  const abortIntentKey = planAbortIntentKey(planPath, command.planId);
  activePlanAbortIntents.add(abortIntentKey);
  try {
    const plan = await loadSessionPlan(planPath);
    if (!plan) {
      return fail(requestId, 'plan/abort', 'No plan for session');
    }
    if (plan.id !== command.planId) {
      return fail(
        requestId,
        'plan/abort',
        `plan id mismatch: requested ${command.planId} but session has ${plan.id}`,
      );
    }
    if (
      !plan.execution ||
      (plan.execution.status !== 'running' && plan.execution.status !== 'queued')
    ) {
      return fail(
        requestId,
        'plan/abort',
        `plan is not running (status: ${plan.execution?.status ?? 'none'})`,
      );
    }
    const abortedState = abortExecutionState(plan.execution);
    const abortedPlan: SessionPlan = {
      ...plan,
      status: 'abandoned',
      execution: abortedState,
      revision: plan.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await saveSessionPlan(planPath, abortedPlan);
    context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: abortedPlan });
    context.push({ type: 'plan/execution-updated', state: abortedState });
    const seam = context.planExecution;
    if (seam) {
      seam.cancelPlanRun?.(plan.execution.runId ?? '');
      // Abort the parent turn if inline/verify is running.
      try {
        await seam.abortSession(command.sessionId);
      } catch (error) {
        context.push({
          type: 'host/log',
          level: 'warn',
          message: `plan abort could not stop parent session: ${formatError(error)}`,
        });
      }
    }
    return ok(requestId, 'plan/abort', {
      sessionId: command.sessionId,
      planId: plan.id,
      status: 'aborted',
    });
  } finally {
    activePlanAbortIntents.delete(abortIntentKey);
  }
}

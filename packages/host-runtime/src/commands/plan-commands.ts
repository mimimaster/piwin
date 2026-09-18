/**
 * Host IPC handlers: plan.
 */
import type {
  HostCommand,
  HostResponse,
  PlanExecutionState,
  SessionPlan,
  SessionPlanWriteExpectation,
} from '@piwin/contracts';
import {
  formatError,
  isSessionPlanVersion,
  isSessionPlanWriteExpectation,
} from '@piwin/contracts';
import {
  applyPlanStatus,
  applyPlanStepUpdate,
  clearSessionPlan,
  getSessionRecord,
  loadSessionPlan,
  PlanAlreadyExistsError,
  PlanMutationError,
  PlanRevisionConflictError,
  updateSessionPlan,
  validateSessionPlan,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { getPiwinRoot, getPiwinSessionIndexPath, getPiwinSessionPlanPath } from '../paths.js';
import type { HostCommandContext } from './host-command-context.js';
import {
  abortExecutionState,
  buildInlineDirective,
  buildPlanSubagentTasks,
  buildPlanSummary,
  buildSubagentVerificationDirective,
  completeExecutionState,
  createExecutionState,
  failExecutionState,
  recoverPlanAfterExecutionFailure,
  selectSubagentSteps,
} from '../plan-execution-coordinator.js';
import { sessionBusyResponse } from '../session-body-gate.js';
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

class StalePlanExecutionError extends Error {
  readonly name = 'StalePlanExecutionError';
}

function requireAdmittedExecution(
  current: SessionPlan | null,
  admittedPlanId: string,
  planRunId: string,
): { plan: SessionPlan; execution: NonNullable<SessionPlan['execution']> } {
  const execution = current?.execution;
  if (
    current === null ||
    current.id !== admittedPlanId ||
    execution === undefined ||
    execution.runId !== planRunId
  ) {
    throw new StalePlanExecutionError(
      `stale plan execution ${planRunId} for ${admittedPlanId}`,
    );
  }
  return { plan: current, execution };
}

async function mutateSessionPlanOrFail(
  planPath: string,
  requestId: string | undefined,
  commandType: HostCommand['type'],
  mutator: (current: SessionPlan | null) => SessionPlan | null,
  expected?: SessionPlanWriteExpectation,
): Promise<{ ok: true; plan: SessionPlan } | { ok: false; response: HostResponse }> {
  try {
    const plan = await updateSessionPlan(planPath, mutator, expected);
    if (!plan) {
      return { ok: false, response: fail(requestId, commandType, 'No plan for session') };
    }
    return { ok: true, plan };
  } catch (error) {
    if (error instanceof PlanMutationError) {
      return { ok: false, response: fail(requestId, commandType, error.message) };
    }
    if (error instanceof PlanRevisionConflictError) {
      return { ok: false, response: fail(requestId, commandType, error.message) };
    }
    if (error instanceof PlanAlreadyExistsError) {
      return { ok: false, response: fail(requestId, commandType, error.message) };
    }
    throw error;
  }
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
      if (!isSessionPlanWriteExpectation(command.expected)) {
        return fail(
          requestId,
          'plan/set',
          'plan/set requires expected: null for create or { planId, revision } for update',
        );
      }
      const validated = validateSessionPlan(command.plan);
      if (!validated.ok) {
        return fail(
          requestId,
          'plan/set',
          validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
        );
      }
      if (
        command.expected !== null &&
        validated.plan.id !== command.expected.planId
      ) {
        return fail(
          requestId,
          'plan/set',
          `plan id mismatch: expected ${command.expected.planId} but payload has ${validated.plan.id}`,
        );
      }
      const now = new Date().toISOString();
      const mutated = await mutateSessionPlanOrFail(
        getPiwinSessionPlanPath(rootDir, command.sessionId),
        requestId,
        'plan/set',
        (previous) => {
          return {
            ...validated.plan,
            sessionId: command.sessionId,
            projectPath: existing.projectPath,
            id: previous?.id ?? validated.plan.id,
            createdAt: previous?.createdAt ?? validated.plan.createdAt ?? now,
            updatedAt: now,
            ...(previous?.execution === undefined ? {} : { execution: previous.execution }),
          };
        },
        command.expected,
      );
      if (!mutated.ok) return mutated.response;
      const plan = mutated.plan;
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan });
      return ok(requestId, 'plan/set', { plan });
    }
    case 'plan/clear': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      if (!isSessionPlanVersion(command.expected)) {
        return fail(
          requestId,
          'plan/clear',
          'plan/clear requires expected: { planId, revision }',
        );
      }
      try {
        await clearSessionPlan(
          getPiwinSessionPlanPath(rootDir, command.sessionId),
          command.expected,
        );
      } catch (error) {
        if (error instanceof PlanMutationError || error instanceof PlanRevisionConflictError) {
          return fail(requestId, 'plan/clear', error.message);
        }
        throw error;
      }
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: null });
      return ok(requestId, 'plan/clear', { sessionId: command.sessionId });
    }
    case 'plan/approve': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
      const mutated = await mutateSessionPlanOrFail(planPath, requestId, 'plan/approve', (plan) => {
        if (!plan) throw new PlanMutationError('No plan for session');
        if (plan.status !== 'draft' && plan.status !== 'approved') {
          throw new PlanMutationError(`Cannot approve plan in status ${plan.status}`);
        }
        return {
          ...plan,
          status: 'approved' as const,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
      });
      if (!mutated.ok) return mutated.response;
      const approved = mutated.plan;
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: approved });
      return ok(requestId, 'plan/approve', { plan: approved });
    }
    case 'plan/update-step': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
      const previousStatusHolder: { status?: SessionPlan['status'] } = {};
      const mutated = await mutateSessionPlanOrFail(
        planPath,
        requestId,
        'plan/update-step',
        (plan) => {
          if (!plan) throw new PlanMutationError('No plan for session');
          previousStatusHolder.status = plan.status;
          const result = applyPlanStepUpdate({
            plan,
            stepId: command.stepId,
            status: command.status,
            ...(typeof command.detail === 'string' ? { detail: command.detail } : {}),
          });
          if (!result.ok) {
            throw new PlanMutationError(result.error);
          }
          return result.plan;
        },
      );
      if (!mutated.ok) return mutated.response;
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: mutated.plan });
      if (
        previousStatusHolder.status !== undefined &&
        mutated.plan.status !== previousStatusHolder.status
      ) {
        context.push({
          type: 'host/log',
          level: 'info',
          message: `plan ${command.sessionId} status ${previousStatusHolder.status} → ${mutated.plan.status}`,
        });
      }
      return ok(requestId, 'plan/update-step', { plan: mutated.plan });
    }
    case 'plan/set-status': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
      const mutated = await mutateSessionPlanOrFail(
        planPath,
        requestId,
        'plan/set-status',
        (plan) => {
          if (!plan) throw new PlanMutationError('No plan for session');
          const result = applyPlanStatus({ plan, status: command.status });
          if (!result.ok) {
            throw new PlanMutationError(result.error);
          }
          return result.plan;
        },
      );
      if (!mutated.ok) return mutated.response;
      context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: mutated.plan });
      return ok(requestId, 'plan/set-status', { plan: mutated.plan });
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
  if (context.isSessionBodyReserved?.(command.request.sessionId) === true) {
    return sessionBusyResponse(
      requestId,
      'plan/execute',
      command.request.sessionId,
      'body-job',
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
  let started: Awaited<ReturnType<typeof mutateSessionPlanOrFail>>;
  try {
    started = await mutateSessionPlanOrFail(planPath, requestId, 'plan/execute', (current) => {
      if (!current) throw new PlanMutationError('No plan for session');
      if (current.id !== command.request.planId) {
        throw new PlanMutationError(
          `plan id mismatch: requested ${command.request.planId} but session has ${current.id}`,
        );
      }
      if (
        command.request.expectedRevision !== undefined &&
        current.revision !== command.request.expectedRevision
      ) {
        throw new PlanRevisionConflictError(
          `plan revision mismatch: requested ${command.request.expectedRevision} but session has ${current.revision}`,
        );
      }
      const canApproveDraft = current.status === 'draft' && command.request.approveDraft === true;
      if (current.status !== 'approved' && current.status !== 'executing' && !canApproveDraft) {
        throw new PlanMutationError(
          `plan must be approved before execution or explicitly approved atomically (current status: ${current.status})`,
        );
      }
      if (
        current.execution &&
        (current.execution.status === 'running' || current.execution.status === 'queued')
      ) {
        throw new PlanMutationError(
          `plan is already ${current.execution.status} with mode ${current.execution.mode}`,
        );
      }
      state = {
        ...createExecutionState(current, command.request.mode),
        runId: planRun.runId,
      };
      return {
        ...current,
        status: 'executing',
        execution: state,
        updatedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    const message = formatError(error);
    context.planExecution?.finishPlanRun?.(planRun.runId, 'failed', message);
    return fail(requestId, 'plan/execute', message);
  }
  if (!started.ok) {
    const errorMsg = 'error' in started.response ? started.response.error : undefined;
    context.planExecution?.finishPlanRun?.(planRun.runId, 'failed', errorMsg);
    return started.response;
  }
  const executingPlan = started.plan;
  context.push({ type: 'plan/updated', sessionId: command.request.sessionId, plan: executingPlan });
  context.push({ type: 'plan/execution-updated', state });

  // Detach the orchestration so the IPC call returns immediately. The UI
  // observes progress via plan/updated and plan/execution-updated pushes.
  void runPlanExecution(
    command.request.sessionId,
    executingPlan,
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
    const updated = await updateSessionPlan(planPath, (current) => {
      const admitted = requireAdmittedExecution(current, plan.id, planRunId);
      const currentExecution = admitted.execution;
      if (
        currentExecution.status === 'aborted' ||
        currentExecution.status === 'completed' ||
        currentExecution.status === 'failed' ||
        activePlanAbortIntents.has(planAbortIntentKey(planPath, plan.id))
      ) {
        throw new StalePlanExecutionError(`plan execution ${planRunId} is no longer running`);
      }
      state = {
        ...currentExecution,
        status: 'running',
        ...(currentStepId ? { currentStepId } : {}),
      };
      return {
        ...admitted.plan,
        execution: state,
        updatedAt: new Date().toISOString(),
      };
    });
    if (!updated?.execution) return state;
    state = updated.execution;
    context.push({ type: 'plan/updated', sessionId, plan: updated });
    context.push({ type: 'plan/execution-updated', state });
    return state;
  };

  const markFailed = async (error: string): Promise<void> => {
    try {
      let cancelled = false;
      const updated = await updateSessionPlan(planPath, (current) => {
        const admitted = requireAdmittedExecution(current, plan.id, planRunId);
        const currentExecution = admitted.execution;
        if (
          currentExecution.status === 'aborted' ||
          currentExecution.status === 'completed' ||
          currentExecution.status === 'failed' ||
          activePlanAbortIntents.has(planAbortIntentKey(planPath, plan.id))
        ) {
          cancelled = true;
          return null;
        }
        state = failExecutionState(currentExecution, error);
        return recoverPlanAfterExecutionFailure(admitted.plan, state);
      });
      if (cancelled) {
        context.planExecution?.finishPlanRun?.(planRunId, 'cancelled');
        return;
      }
      if (!updated) {
        context.planExecution?.finishPlanRun?.(planRunId, 'failed', error);
        return;
      }
      if (updated.execution) {
        state = updated.execution;
      }
      context.push({ type: 'plan/updated', sessionId, plan: updated });
      context.push({ type: 'plan/execution-updated', state });
      context.planExecution?.finishPlanRun?.(planRunId, 'failed', error);
    } catch (caught) {
      if (caught instanceof StalePlanExecutionError) {
        context.planExecution?.finishPlanRun?.(planRunId, 'cancelled');
        return;
      }
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `plan markFailed persist failed: ${formatError(caught)}`,
      });
      context.planExecution?.finishPlanRun?.(planRunId, 'failed', error);
    }
  };

  const settleByStepTerminals = async (
    finalAssistantMessageId: string,
    incompleteMessage: string,
  ): Promise<void> => {
    let cancelled = false;
    let completed = false;
    const updated = await updateSessionPlan(planPath, (current) => {
      const admitted = requireAdmittedExecution(current, plan.id, planRunId);
      const currentExecution = admitted.execution;
      if (
        currentExecution.status === 'aborted' ||
        currentExecution.status === 'completed' ||
        currentExecution.status === 'failed' ||
        activePlanAbortIntents.has(planAbortIntentKey(planPath, plan.id))
      ) {
        cancelled = true;
        return null;
      }
      const allTerminal =
        admitted.plan.steps.length > 0 &&
        admitted.plan.steps.every((step) => step.status === 'done' || step.status === 'skipped');
      if (allTerminal) {
        completed = true;
        const completedState = completeExecutionState(currentExecution);
        const summary = buildPlanSummary({
          plan: { ...admitted.plan, execution: completedState },
          mode,
          mergedChildSessionIds: completedState.childSessionIds,
          verificationResult: `Final assistant verification completed in message ${finalAssistantMessageId}`,
        });
        state = { ...completedState, summary };
        return {
          ...admitted.plan,
          status: 'done',
          execution: state,
          updatedAt: new Date().toISOString(),
        };
      }
      state = failExecutionState(currentExecution, incompleteMessage);
      return recoverPlanAfterExecutionFailure(admitted.plan, state);
    });
    if (cancelled) {
      context.planExecution?.finishPlanRun?.(planRunId, 'cancelled');
      return;
    }
    if (!updated) return;
    if (updated.execution) {
      state = updated.execution;
    }
    context.push({ type: 'plan/updated', sessionId, plan: updated });
    context.push({ type: 'plan/execution-updated', state });
    if (completed) {
      context.planExecution?.finishPlanRun?.(planRunId, 'completed');
      await triggerPlanCompletionWalkthrough(
        sessionId,
        updated,
        finalAssistantMessageId,
        context,
      );
      return;
    }
    context.planExecution?.finishPlanRun?.(planRunId, 'failed', incompleteMessage);
  };

  try {
    if (mode === 'inline') {
      await markRunning();
      const directive = buildInlineDirective(plan);
      const completion = await seam.promptSession(sessionId, directive.promptText, planRunId);
      await settleByStepTerminals(
        completion.finalAssistantMessageId,
        'inline execution ended before all plan steps reached a terminal status',
      );
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
      await settleByStepTerminals(
        completion.finalAssistantMessageId,
        'inline execution ended before all plan steps reached a terminal status',
      );
      return;
    }

    // CE-SUB-ORCH: route all subagent-driven plan execution through the
    // orchestrator. The sequential spawnSubagent fallback has been removed
    // (ADR 0030 Phase D).
    const childIds: string[] = [];
    await markRunning();
    const tasks = buildPlanSubagentTasks(plan, stepIds);

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
    let executionAlreadyClosed = false;
    const updated = await updateSessionPlan(planPath, (current) => {
      const admitted = requireAdmittedExecution(current, plan.id, planRunId);
      const currentExecution = admitted.execution;
      if (
        currentExecution.status === 'aborted' ||
        currentExecution.status === 'completed' ||
        currentExecution.status === 'failed'
      ) {
        executionAlreadyClosed = true;
        return null;
      }
      return {
        ...admitted.plan,
        execution: {
          ...currentExecution,
          childSessionIds: [...new Set([...currentExecution.childSessionIds, ...childIds])],
        },
        updatedAt: new Date().toISOString(),
      };
    });
    if (updated?.execution) {
      state = updated.execution;
      context.push({ type: 'plan/updated', sessionId, plan: updated });
      context.push({ type: 'plan/execution-updated', state });
    }

    if (executionAlreadyClosed || batchResult.status === 'cancelled') {
      // plan/abort (or another closer) owns the terminal plan transition.
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
    await settleByStepTerminals(
      completion.finalAssistantMessageId,
      'verification ended before all plan steps reached a terminal status',
    );
  } catch (error) {
    if (error instanceof StalePlanExecutionError) {
      context.planExecution?.finishPlanRun?.(planRunId, 'cancelled');
      return;
    }
    const message = formatError(error);
    try {
      await markFailed(message);
    } catch (persistError) {
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `plan execution failed and persist also failed: ${formatError(persistError)}`,
      });
      context.planExecution?.finishPlanRun?.(planRunId, 'failed', message);
    }
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
    const aborted = await mutateSessionPlanOrFail(planPath, requestId, 'plan/abort', (current) => {
      if (!current) throw new PlanMutationError('No plan for session');
      if (current.id !== command.planId) {
        throw new PlanMutationError(
          `plan id mismatch: requested ${command.planId} but session has ${current.id}`,
        );
      }
      if (
        !current.execution ||
        (current.execution.status !== 'running' && current.execution.status !== 'queued')
      ) {
        throw new PlanMutationError(
          `plan is not running (status: ${current.execution?.status ?? 'none'})`,
        );
      }
      return {
        ...current,
        status: 'abandoned',
        execution: abortExecutionState(current.execution),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
    });
    if (!aborted.ok) return aborted.response;
    const abortedPlan = aborted.plan;
    const abortedExecution = abortedPlan.execution ?? abortedState;
    context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: abortedPlan });
    context.push({ type: 'plan/execution-updated', state: abortedExecution });
    const seam = context.planExecution;
    if (seam) {
      seam.cancelPlanRun?.(abortedExecution.runId ?? plan.execution.runId ?? '');
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

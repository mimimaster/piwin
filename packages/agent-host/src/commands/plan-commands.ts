/**
 * Host IPC handlers: plan.
 */
import type { HostCommand, HostResponse, PlanExecutionState, SessionPlan } from '@piwin/contracts';
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
  buildSubagentTaskDirective,
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
  if (plan.status !== 'approved' && plan.status !== 'executing') {
    return fail(
      requestId,
      'plan/execute',
      `plan must be approved before execution (current status: ${plan.status})`,
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

  let state = createExecutionState(plan, command.request.mode);
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
  void runPlanExecution(command.request.sessionId, plan, command.request.mode, seam, context).catch(
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
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
  });
}

async function runPlanExecution(
  sessionId: string,
  plan: SessionPlan,
  mode: PlanExecutionState['mode'],
  seam: NonNullable<HostCommandContext['planExecution']>,
  context: HostCommandContext,
): Promise<void> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const planPath = getPiwinSessionPlanPath(rootDir, sessionId);

  let state = createExecutionState(plan, mode);

  const markRunning = async (currentStepId?: string): Promise<PlanExecutionState> => {
    const current = await loadSessionPlan(planPath);
    if (!current || !current.execution) return state;
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
    state = failExecutionState(state, error);
    const updated: SessionPlan = {
      ...current,
      execution: state,
      updatedAt: new Date().toISOString(),
    };
    await saveSessionPlan(planPath, updated);
    context.push({ type: 'plan/updated', sessionId, plan: updated });
    context.push({ type: 'plan/execution-updated', state });
  };

  const markCompleted = async (): Promise<void> => {
    const current = await loadSessionPlan(planPath);
    if (!current) return;
    state = completeExecutionState(state);
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

    // Walkthrough is always generated when a plan completes.
    // Find the final assistant message and trigger generation.
    await triggerPlanCompletionWalkthrough(sessionId, context);
  };

  try {
    if (mode === 'inline') {
      await markRunning();
      const directive = buildInlineDirective(plan);
      await seam.promptSession(sessionId, directive.promptText);
      // Inline execution completes when the model finishes its turn and
      // updates steps via piwin_plan_set_step. The host does not block on
      // the turn here; the plan status transitions to done via step updates
      // or a subsequent plan/set-status. We mark completed optimistically
      // only if all steps are already done.
      const latest = await loadSessionPlan(planPath);
      if (
        latest &&
        latest.steps.every((step) => step.status === 'done' || step.status === 'skipped')
      ) {
        await markCompleted();
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
      await seam.promptSession(sessionId, directive.promptText);
      return;
    }

    // CE-SUB-ORCH: if steps declare dependsOn/parallelGroup and the seam
    // exposes runBatch, route through the orchestrator for DAG scheduling.
    const childIds: string[] = [];
    const hasDagMetadata = plan.steps.some(
      (s) => s.dependsOn !== undefined || s.parallelGroup !== undefined,
    );
    if (hasDagMetadata && seam.runBatch) {
      await markRunning();
      const tasks = stepIds
        .map((stepId) => {
          const step = plan.steps.find((s) => s.id === stepId);
          const directive = buildSubagentTaskDirective(plan, stepId);
          if (!directive || !step) return undefined;
          return {
            id: stepId,
            parentSessionId: sessionId,
            task: directive.promptText,
            ...(step.profileId ? { profileId: step.profileId } : {}),
            ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}),
            ...(step.parallelGroup ? { parallelGroup: step.parallelGroup } : {}),
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== undefined);

      const batchResult = await seam.runBatch({
        parentSessionId: sessionId,
        tasks,
      });

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

      if (batchResult.status !== 'completed') {
        await markFailed(`batch ${batchResult.status}`);
        return;
      }

      // Parent runs final verification and posts the walkthrough.
      await markRunning();
      const verifyDirective = buildSubagentVerificationDirective(plan);
      await seam.promptSession(sessionId, verifyDirective.promptText);

      const latest = await loadSessionPlan(planPath);
      if (
        latest &&
        latest.steps.every((step) => step.status === 'done' || step.status === 'skipped')
      ) {
        await markCompleted();
      }
      return;
    }

    // Legacy sequential path (no DAG metadata or no runBatch seam).
    for (const stepId of stepIds) {
      const directive = buildSubagentTaskDirective(plan, stepId);
      if (!directive) continue;
      await markRunning(stepId);
      // CE-SUB-PROF: pass per-step profileId when the plan step specifies one.
      const step = plan.steps.find((s) => s.id === stepId);
      const spawned = await seam.spawnSubagent({
        parentSessionId: sessionId,
        task: directive.promptText,
        sessionName: `plan-${plan.id}-step-${stepId}`,
        mode: 'worktree',
        applyPolicy: 'explicit',
        ...(step?.profileId ? { profileId: step.profileId } : {}),
      });
      childIds.push(spawned.childSessionId);
      state = { ...state, childSessionIds: [...state.childSessionIds, spawned.childSessionId] };
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
      // Merge the child into the parent before moving to the next step to
      // keep changes ordered and avoid worktree conflicts.
      await seam.mergeSubagent(spawned.childSessionId);
    }

    // Parent runs final verification and posts the walkthrough.
    await markRunning();
    const verifyDirective = buildSubagentVerificationDirective(plan);
    await seam.promptSession(sessionId, verifyDirective.promptText);

    const latest = await loadSessionPlan(planPath);
    if (
      latest &&
      latest.steps.every((step) => step.status === 'done' || step.status === 'skipped')
    ) {
      await markCompleted();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
  context: HostCommandContext,
): Promise<void> {
  const walkthroughBag = context.walkthrough;
  if (!walkthroughBag) return;

  try {
    const messages = await walkthroughBag.context.loadTranscriptMessages(sessionId);
    // Find the last assistant message with completed outcome.
    let lastAssistantId: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if (msg.role === 'assistant' && msg.status === 'done') {
        lastAssistantId = msg.id;
        break;
      }
    }
    if (!lastAssistantId) return;

    const config = await walkthroughBag.context.loadConfig();
    const walkthrough = config.walkthrough ?? createDefaultWalkthroughConfig();
    const targetMessage = messages.find((m) => m.id === lastAssistantId);
    if (!targetMessage) return;

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
      lastAssistantId,
      model,
      provider,
      'default',
      walkthrough,
      targetMessage,
      messages,
      walkthroughBag.context,
      walkthroughBag.registry,
    ).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      context.push({
        type: 'host/log',
        level: 'error',
        message: `plan walkthrough generation failed: ${detail}`,
      });
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
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
  const plan = await loadSessionPlan(planPath);
  if (!plan) {
    return fail(requestId, 'plan/abort', 'No plan for session');
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
  const seam = context.planExecution;
  if (seam) {
    // Abort any spawned child sessions.
    for (const childId of plan.execution.childSessionIds) {
      try {
        await seam.abortSession(childId);
      } catch {
        // best-effort
      }
    }
    // Abort the parent turn if inline/verify is running.
    try {
      await seam.abortSession(command.sessionId);
    } catch {
      // best-effort
    }
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
  return ok(requestId, 'plan/abort', {
    sessionId: command.sessionId,
    planId: plan.id,
    status: 'aborted',
  });
}

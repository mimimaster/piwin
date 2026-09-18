/**
 * Pure helpers for plan execution orchestration.
 *
 * These functions build execution state, inline/subagent prompt directives,
 * and walkthrough summaries without performing any I/O. The command handler
 * in plan-commands.ts composes them with session/plan persistence and
 * subagent spawn/merge side effects.
 */
import type {
  PlanExecutionMode,
  PlanExecutionState,
  PlanExecutionSummary,
  SessionPlan,
  SubagentTaskSpec,
  SubagentTaskResult,
} from '@piwin/contracts';
import { MAX_PLAN_EXECUTION_ERROR_CHARS, MAX_PLAN_WALKTHROUGH_UNRESOLVED } from '@piwin/contracts';

export type InlineDirective = {
  promptText: string;
};

/**
 * Build the prompt sent to the parent session for inline execution.
 * The model is instructed to execute the approved plan step by step,
 * update step status via piwin_plan_set_step, run verification, and
 * finish with a concise completion. The Host generates the separate
 * Walkthrough Artifact after the plan reaches done.
 */
export function buildInlineDirective(plan: SessionPlan): InlineDirective {
  const stepList = plan.steps
    .map((step) => `- [${step.id}] ${step.title}${step.detail ? ` — ${step.detail}` : ''}`)
    .join('\n');
  return {
    promptText: [
      `[piwin-plan-execute:inline v2] Plan: ${plan.title}`,
      `Goal: ${plan.goal}`,
      '',
      'Execute this plan directly in the current session. Do not spawn subagents or ask the user to choose an execution mode again.',
      'Success: complete each step against its acceptance criteria with verification evidence.',
      'Use piwin_plan_set_step (active → done/skipped); mark done only with a short verification note.',
      'Stop at blockers or failed checks; do not invent scope beyond this plan.',
      'When finished, keep the chat completion concise; the Host generates the separate Walkthrough Artifact.',
      '',
      'Steps:',
      stepList,
    ].join('\n'),
  };
}

export type SubagentTaskDirective = {
  stepId: string;
  promptText: string;
};

/**
 * Build the task brief for a single isolated step executed in a child
 * subagent session. The child sees only this brief — not the parent transcript.
 */
export function buildSubagentTaskDirective(plan: SessionPlan, stepId: string): SubagentTaskDirective | null {
  const step = plan.steps.find((entry) => entry.id === stepId);
  if (!step) return null;
  return {
    stepId,
    promptText: [
      `[piwin-plan-execute:subagent v3] Plan: ${plan.title} — step ${step.id}`,
      `Goal: ${plan.goal}`,
      '',
      `Step: [${step.id}] ${step.title}`,
      `Success: complete only this step — ${step.title} — against its acceptance criteria.`,
      step.detail
        ? `Acceptance and verification: ${step.detail}`
        : 'Acceptance: complete this step as titled; verification must be an executable check.',
      'Constraints: do not implement other plan steps; do not expand scope; do not edit unrelated files.',
      'You cannot see the parent conversation. Treat this brief as the full task.',
      'Done: acceptance criteria pass and the stated verification command (or observable check) has been run.',
      'Report: status=done|blocked|needs_context; changed files; verification output; blockers.',
      'Stop: do not implement other plan steps or expand scope.',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
  };
}

/** Build the executable batch task for one independent plan step. */
export function buildPlanSubagentTask(
  plan: SessionPlan,
  stepId: string,
): SubagentTaskSpec | null {
  const step = plan.steps.find((entry) => entry.id === stepId);
  const directive = buildSubagentTaskDirective(plan, stepId);
  if (!step || !directive) return null;
  return {
    id: stepId,
    parentSessionId: plan.sessionId,
    task: directive.promptText,
    profileId: step.profileId ?? 'implementer',
    applyPolicy: 'explicit',
    deliveryIntent: 'candidate',
    retainWorktree: true,
    ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}),
    ...(step.parallelGroup ? { parallelGroup: step.parallelGroup } : {}),
  };
}

/**
 * Serialize write slices that omitted dependsOn so Host never dispatches
 * them as concurrent writers. Existing dependsOn edges are left intact.
 */
export function chainPlanWriteTaskDependencies(
  tasks: readonly SubagentTaskSpec[],
): SubagentTaskSpec[] {
  const chained: SubagentTaskSpec[] = [];
  let previousId: string | undefined;
  for (const task of tasks) {
    const hasDeps = (task.dependsOn?.length ?? 0) > 0;
    if (!hasDeps && previousId) {
      chained.push({ ...task, dependsOn: [previousId] });
    } else {
      chained.push(task);
    }
    previousId = task.id;
  }
  return chained;
}

/** Build every eligible plan child task, then force a serial write chain. */
export function buildPlanSubagentTasks(
  plan: SessionPlan,
  stepIds: readonly string[],
): SubagentTaskSpec[] {
  const tasks = stepIds
    .map((stepId) => buildPlanSubagentTask(plan, stepId))
    .filter((task): task is SubagentTaskSpec => task !== null);
  return chainPlanWriteTaskDependencies(tasks);
}

/**
 * Build the parent verification prompt sent after all subagent steps have
 * been merged. The parent runs final verification and posts the walkthrough.
 */
export function buildSubagentVerificationDirective(
  plan: SessionPlan,
  results: readonly SubagentTaskResult[] = [],
): InlineDirective {
  const independentStepIds = new Set(plan.independentSteps ?? []);
  const parentSteps = plan.steps.filter((step) => !independentStepIds.has(step.id));
  const parentStepBlock = parentSteps.length
    ? [
        '',
        'Parent-owned sequential steps (execute these now before final verification):',
        ...parentSteps.map(
          (step) =>
            `- [${step.id}] ${step.title}${step.detail ? ` — ${step.detail}` : ''}`,
        ),
      ]
    : [];
  const childEvidence = results
    .map((result) => {
      const details = [
        `- [${result.taskId}] execution=${result.executionStatus}, summary=${result.summaryStatus}, integration=${result.integrationStatus}`,
        result.childSessionId ? `  child: ${result.childSessionId}` : '',
        result.summaryPreview ? `  summary: ${result.summaryPreview}` : '',
        result.changedFiles?.length ? `  changed: ${result.changedFiles.join(', ')}` : '',
        result.verification ? `  verification: ${result.verification}` : '',
        result.error ? `  error: ${result.error}` : '',
      ].filter((line) => line.length > 0);
      return details.join('\n');
    })
    .join('\n')
    .slice(0, 12_000);
  const evidenceBlock = childEvidence ? ['', 'Child execution evidence:', childEvidence] : [];
  return {
    promptText: [
      `[piwin-plan-execute:verify v2] Plan: ${plan.title}`,
      `Goal: ${plan.goal}`,
      '',
      'Success: child slices are candidates; whole-plan acceptance criteria pass with evidence.',
      'Review each child from diffs, changed-file lists, and verification output only — not from the child transcript.',
      'Do not rewrite child work in the parent; apply an approved candidate (piwin_subagent_result_apply) or send a repair brief.',
      'First validate the child results and update their plan steps from evidence.',
      'Then implement every parent-owned pending/active step in the parent workspace; never mark an unexecuted step done.',
      'Finally run whole-plan verification and update all remaining steps via piwin_plan_set_step.',
      'Stop if verification fails — report blockers; do not claim green without evidence.',
      'Keep the chat completion concise; the Host generates the separate Walkthrough Artifact.',
      ...parentStepBlock,
      ...evidenceBlock,
    ].join('\n'),
  };
}

export function createExecutionState(
  plan: SessionPlan,
  mode: PlanExecutionMode,
): PlanExecutionState {
  return {
    sessionId: plan.sessionId,
    planId: plan.id,
    mode,
    status: 'queued',
    childSessionIds: [],
  };
}

export function failExecutionState(
  state: PlanExecutionState,
  error: string,
): PlanExecutionState {
  return {
    ...state,
    status: 'failed',
    error: error.slice(0, MAX_PLAN_EXECUTION_ERROR_CHARS),
    endedAt: new Date().toISOString(),
  };
}

/**
 * After a failed run, the plan must become selectable again. Leaving
 * `status: 'executing'` hides the execution gate even though work stopped.
 */
export function recoverPlanAfterExecutionFailure(
  plan: SessionPlan,
  failedState: PlanExecutionState,
): SessionPlan {
  return {
    ...plan,
    status: plan.status === 'executing' ? 'approved' : plan.status,
    execution: failedState,
    updatedAt: new Date().toISOString(),
  };
}

export function abortExecutionState(state: PlanExecutionState): PlanExecutionState {
  return {
    ...state,
    status: 'aborted',
    endedAt: new Date().toISOString(),
  };
}

export function completeExecutionState(state: PlanExecutionState): PlanExecutionState {
  return {
    ...state,
    status: 'completed',
    endedAt: new Date().toISOString(),
  };
}

export type WalkthroughInput = {
  plan: SessionPlan;
  mode: PlanExecutionMode;
  mergedChildSessionIds: string[];
  verificationResult?: string;
  unresolvedItems?: string[];
};

export function buildPlanSummary(input: WalkthroughInput): PlanExecutionSummary {
  const completed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const step of input.plan.steps) {
    if (step.status === 'done') completed.push(step.id);
    else if (step.status === 'skipped') skipped.push(step.id);
    else failed.push(step.id);
  }
  const unresolved = (input.unresolvedItems ?? []).slice(0, MAX_PLAN_WALKTHROUGH_UNRESOLVED);
  return {
    planId: input.plan.id,
    mode: input.mode,
    completedStepIds: completed,
    failedStepIds: failed,
    skippedStepIds: skipped,
    mergedChildSessionIds: input.mergedChildSessionIds,
    ...(input.verificationResult ? { verificationResult: input.verificationResult } : {}),
    ...(unresolved.length > 0 ? { unresolvedItems: unresolved } : {}),
    ...(input.plan.execution?.startedAt ? { startedAt: input.plan.execution.startedAt } : {}),
    ...(input.plan.execution?.endedAt ? { endedAt: input.plan.execution.endedAt } : {}),
  };
}

/**
 * Select the steps that should run as independent subagent tasks.
 * Returns step ids in plan order. If the plan declares independentSteps,
 * only those are eligible; otherwise returns an empty list (caller should
 * fall back to inline execution for the whole plan).
 */
export function selectSubagentSteps(plan: SessionPlan): string[] {
  const ids = plan.independentSteps ?? [];
  const known = new Set(plan.steps.map((step) => step.id));
  return ids.filter((id) => known.has(id));
}

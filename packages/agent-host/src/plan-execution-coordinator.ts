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
  PlanExecutionWalkthrough,
  SessionPlan,
} from '@piwin/contracts';
import { MAX_PLAN_EXECUTION_ERROR_CHARS, MAX_PLAN_WALKTHROUGH_UNRESOLVED } from '@piwin/contracts';

export type InlineDirective = {
  promptText: string;
};

/**
 * Build the prompt sent to the parent session for inline execution.
 * The model is instructed to execute the approved plan step by step,
 * update step status via piwin_plan_set_step, run verification, and
 * finish with a walkthrough summary. The host does not execute steps
 * itself — it only frames the work.
 */
export function buildInlineDirective(plan: SessionPlan): InlineDirective {
  const stepList = plan.steps
    .map((step) => `- [${step.id}] ${step.title}${step.detail ? ` — ${step.detail}` : ''}`)
    .join('\n');
  return {
    promptText: [
      `[piwin-plan-execute:inline] Plan: ${plan.title}`,
      `Goal: ${plan.goal}`,
      '',
      'Execute the approved plan below step by step in this session.',
      'For each step:',
      '1. Call piwin_plan_set_step with status "active" before starting.',
      '2. Implement the step.',
      '3. Run the verification described in the step detail.',
      '4. Call piwin_plan_set_step with status "done" (or "skipped" with a note).',
      'Only one step should be active at a time.',
      'When all steps are complete, post a bounded walkthrough summary:',
      '- what changed (files/areas);',
      '- verification results;',
      '- unresolved items or follow-ups.',
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
 * Build the task prompt for a single independent step executed in a child
 * subagent session. The child is told to complete only this step and report
 * a concise result; the parent merges and verifies.
 */
export function buildSubagentTaskDirective(plan: SessionPlan, stepId: string): SubagentTaskDirective | null {
  const step = plan.steps.find((entry) => entry.id === stepId);
  if (!step) return null;
  return {
    stepId,
    promptText: [
      `[piwin-plan-execute:subagent] Plan: ${plan.title} — step ${step.id}`,
      `Goal: ${plan.goal}`,
      '',
      `Complete ONLY this step: ${step.title}.`,
      step.detail ? `Detail: ${step.detail}` : '',
      '',
      'When finished, post a concise result: what you changed, verification output, and any blockers.',
      'Do not attempt other plan steps.',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
  };
}

/**
 * Build the parent verification prompt sent after all subagent steps have
 * been merged. The parent runs final verification and posts the walkthrough.
 */
export function buildSubagentVerificationDirective(plan: SessionPlan): InlineDirective {
  return {
    promptText: [
      `[piwin-plan-execute:verify] Plan: ${plan.title}`,
      `Goal: ${plan.goal}`,
      '',
      'All independent plan steps have been executed by subagent sessions and merged.',
      'Run final verification for the whole plan, then post a bounded walkthrough summary:',
      '- what changed (files/areas);',
      '- verification results;',
      '- merged child sessions;',
      '- unresolved items or follow-ups.',
      '',
      'Use piwin_plan_set_step to mark any remaining steps done/skipped as needed.',
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

export function buildWalkthrough(input: WalkthroughInput): PlanExecutionWalkthrough {
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

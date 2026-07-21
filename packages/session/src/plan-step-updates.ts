/**
 * Pure plan step status transitions (host-owned plan.json state).
 */
import type { PlanStatus, PlanStepStatus, SessionPlan } from '@piwin/contracts';

export const MAX_PLAN_STEP_NOTE_CHARS = 500;

export type ApplyPlanStepUpdateInput = {
  plan: SessionPlan;
  stepId: string;
  status: PlanStepStatus;
  detail?: string;
  /** When true (default), all terminal steps promote plan to done. */
  autoCompletePlan?: boolean;
};

export type ApplyPlanStepUpdateResult =
  | { ok: true; plan: SessionPlan }
  | { ok: false; error: string };

const TERMINAL_STEP: ReadonlySet<PlanStepStatus> = new Set(['done', 'skipped']);

/**
 * Update one step status; may auto-promote plan approved→executing and all-terminal→done.
 */
export function applyPlanStepUpdate(input: ApplyPlanStepUpdateInput): ApplyPlanStepUpdateResult {
  const stepIndex = input.plan.steps.findIndex((step) => step.id === input.stepId);
  if (stepIndex === -1) {
    return { ok: false, error: `Unknown stepId: ${input.stepId}` };
  }

  const now = new Date().toISOString();
  const steps = input.plan.steps.map((step, index) => {
    if (index !== stepIndex) {
      // Only one step should be active at a time.
      if (input.status === 'active' && step.status === 'active') {
        return { ...step, status: 'pending' as const };
      }
      return step;
    }
    const next = { ...step, status: input.status };
    if (typeof input.detail === 'string') {
      const note = input.detail.slice(0, MAX_PLAN_STEP_NOTE_CHARS);
      if (note.length > 0) {
        next.detail = note;
      }
    }
    return next;
  });

  let planStatus: PlanStatus = input.plan.status;
  if (
    (planStatus === 'approved' || planStatus === 'draft') &&
    (input.status === 'active' || input.status === 'done' || input.status === 'skipped')
  ) {
    if (planStatus === 'approved') {
      planStatus = 'executing';
    }
  }

  const autoComplete = input.autoCompletePlan !== false;
  if (
    autoComplete &&
    (planStatus === 'executing' || planStatus === 'approved') &&
    steps.length > 0 &&
    steps.every((step) => TERMINAL_STEP.has(step.status))
  ) {
    planStatus = 'done';
  }

  return {
    ok: true,
    plan: {
      ...input.plan,
      steps,
      status: planStatus,
      revision: input.plan.revision + 1,
      updatedAt: now,
    },
  };
}

export type ApplyPlanStatusInput = {
  plan: SessionPlan;
  status: PlanStatus;
};

/**
 * Direct plan status write (e.g. abandon / mark done).
 */
export function applyPlanStatus(input: ApplyPlanStatusInput): ApplyPlanStepUpdateResult {
  return {
    ok: true,
    plan: {
      ...input.plan,
      status: input.status,
      revision: input.plan.revision + 1,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Mark first pending step active; previous active becomes done.
 */
export function markNextPlanStepActive(plan: SessionPlan): ApplyPlanStepUpdateResult {
  const firstPending = plan.steps.find((step) => step.status === 'pending');
  if (!firstPending) {
    return { ok: false, error: 'No pending steps' };
  }
  const steps = plan.steps.map((step) => {
    if (step.status === 'active') {
      return { ...step, status: 'done' as const };
    }
    if (step.id === firstPending.id) {
      return { ...step, status: 'active' as const };
    }
    return step;
  });
  let planStatus: PlanStatus = plan.status;
  if (planStatus === 'approved') {
    planStatus = 'executing';
  }
  return {
    ok: true,
    plan: {
      ...plan,
      steps,
      status: planStatus,
      revision: plan.revision + 1,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Pure plan complexity classification.
 *
 * Used to recommend an execution mode: long plans should expose
 * subagent-driven execution; short plans default to inline. The
 * classifier is intentionally simple and deterministic so UI/host
 * logic can rely on it without parsing arbitrary model prose.
 */
import type { PlanComplexity, SessionPlan } from '@piwin/contracts';
import { MAX_PLAN_INDEPENDENT_STEPS, MAX_PLAN_STEPS } from '@piwin/contracts';

export const LONG_PLAN_STEP_THRESHOLD = 4;
export const LONG_PLAN_INDEPENDENT_THRESHOLD = 2;

/**
 * Classify a plan as 'short' or 'long'.
 *
 * Rules (in order):
 *   1. 'long' if steps.length >= LONG_PLAN_STEP_THRESHOLD.
 *   2. 'long' if steps.length >= 2 and at least LONG_PLAN_INDEPENDENT_THRESHOLD
 *      valid independent step ids are present.
 *   3. otherwise 'short'.
 *
 * Independent step ids that do not match any step id are ignored by the
 * classifier itself; callers should reject unknown ids at validation time.
 */
export function classifyPlanComplexity(plan: Pick<SessionPlan, 'steps' | 'independentSteps'>): PlanComplexity {
  if (plan.steps.length >= LONG_PLAN_STEP_THRESHOLD) {
    return 'long';
  }
  if (plan.steps.length >= 2 && countValidIndependentSteps(plan) >= LONG_PLAN_INDEPENDENT_THRESHOLD) {
    return 'long';
  }
  return 'short';
}

/** Bound plan shape so callers can reject oversized plans early. */
export function isWithinPlanSizeLimits(plan: Pick<SessionPlan, 'steps' | 'independentSteps'>): boolean {
  return plan.steps.length <= MAX_PLAN_STEPS && (plan.independentSteps?.length ?? 0) <= MAX_PLAN_INDEPENDENT_STEPS;
}

function countValidIndependentSteps(plan: Pick<SessionPlan, 'steps' | 'independentSteps'>): number {
  const ids = new Set(plan.steps.map((step) => step.id));
  let count = 0;
  for (const id of plan.independentSteps ?? []) {
    if (ids.has(id)) count += 1;
  }
  return count;
}

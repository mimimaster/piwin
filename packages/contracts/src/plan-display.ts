import { MAX_PLAN_INDEPENDENT_STEPS, MAX_PLAN_STEPS, type SessionPlan } from './plan.js';

/** Versioned message-bound payload used to render a saved SessionPlan. */
export type PlanDisplayPayload = {
  version: 1;
  /** Durable Host path used by the next execution prompt. */
  path: string;
  /** Stable logical path used by Desktop document navigation. */
  displayPath: string;
  /** Snapshot returned by the plan mutation that produced this message. */
  plan: SessionPlan;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const PLAN_STATUSES = new Set(['draft', 'approved', 'executing', 'done', 'abandoned']);
const PLAN_STEP_STATUSES = new Set(['pending', 'active', 'done', 'skipped']);
const PLAN_SOURCES = new Set(['user', 'assistant', 'skill']);
const PLAN_COMPLEXITIES = new Set(['short', 'long']);
const EXECUTION_STATUSES = new Set(['idle', 'queued', 'running', 'completed', 'failed', 'aborted']);

function isPlanStep(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.title)) {
    return false;
  }
  if (typeof value.status !== 'string' || !PLAN_STEP_STATUSES.has(value.status)) return false;
  for (const key of ['detail', 'profileId', 'parallelGroup'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  }
  if (value.dependsOn !== undefined) {
    if (!Array.isArray(value.dependsOn) || !value.dependsOn.every(isNonEmptyString)) return false;
  }
  return true;
}

function isPlanExecution(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.sessionId) || !isNonEmptyString(value.planId)) return false;
  if (typeof value.status !== 'string' || !EXECUTION_STATUSES.has(value.status)) return false;
  if (value.mode !== undefined && value.mode !== 'inline' && value.mode !== 'subagent-driven') {
    return false;
  }
  for (const key of ['currentStepId', 'runId', 'error', 'startedAt', 'endedAt'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  }
  return true;
}

function isPlanSnapshot(value: unknown): value is SessionPlan {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.sessionId) ||
    !isNonEmptyString(value.projectPath) ||
    typeof value.status !== 'string' ||
    !PLAN_STATUSES.has(value.status) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.goal) ||
    !Array.isArray(value.steps) ||
    value.steps.length > MAX_PLAN_STEPS ||
    !value.steps.every(isPlanStep) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt) ||
    typeof value.source !== 'string' ||
    !PLAN_SOURCES.has(value.source)
  ) {
    return false;
  }
  if (value.skillId !== undefined && !isNonEmptyString(value.skillId)) return false;
  if (value.complexity !== undefined) {
    if (typeof value.complexity !== 'string' || !PLAN_COMPLEXITIES.has(value.complexity)) {
      return false;
    }
  }
  if (value.independentSteps !== undefined) {
    if (
      !Array.isArray(value.independentSteps) ||
      value.independentSteps.length > MAX_PLAN_INDEPENDENT_STEPS ||
      !value.independentSteps.every(isNonEmptyString)
    ) {
      return false;
    }
  }
  if (value.execution !== undefined && !isPlanExecution(value.execution)) return false;
  return true;
}

/** Parse untrusted persisted tool details without making the UI trust casts. */
export function parsePlanDisplayPayload(value: unknown): PlanDisplayPayload | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (typeof value.path !== 'string' || value.path.trim().length === 0) return null;
  if (typeof value.displayPath !== 'string' || value.displayPath.trim().length === 0) return null;
  if (!isPlanSnapshot(value.plan)) return null;
  return {
    version: 1,
    path: value.path,
    displayPath: value.displayPath,
    plan: value.plan,
  };
}

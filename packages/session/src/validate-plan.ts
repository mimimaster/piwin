/**
 * Validate session plan artifacts (size + shape; no executable fields).
 */
import type {
  PlanComplexity,
  PlanExecutionState,
  PlanExecutionStatus,
  PlanSource,
  PlanStatus,
  PlanStep,
  PlanStepStatus,
  SessionPlan,
} from '@piwin/contracts';
import { MAX_PLAN_INDEPENDENT_STEPS, MAX_PLAN_JSON_BYTES, MAX_PLAN_STEPS } from '@piwin/contracts';

const PLAN_STATUSES = new Set<PlanStatus>(['draft', 'approved', 'executing', 'done', 'abandoned']);
const STEP_STATUSES = new Set<PlanStepStatus>(['pending', 'active', 'done', 'skipped']);
const SOURCES = new Set<PlanSource>(['user', 'assistant', 'skill']);
const COMPLEXITIES = new Set<PlanComplexity>(['short', 'long']);
const EXECUTION_STATUSES = new Set<PlanExecutionStatus>([
  'idle',
  'queued',
  'running',
  'completed',
  'failed',
  'aborted',
]);
const EXECUTION_MODES = new Set<PlanExecutionState['mode']>(['inline', 'subagent-driven']);

export type PlanValidationIssue = { path: string; message: string };

export type PlanValidationResult =
  { ok: true; plan: SessionPlan } | { ok: false; issues: PlanValidationIssue[] };

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateSessionPlan(value: unknown): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];
  const encoded = JSON.stringify(value ?? null);
  if (encoded.length > MAX_PLAN_JSON_BYTES) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          message: `plan exceeds ${MAX_PLAN_JSON_BYTES} bytes`,
        },
      ],
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [{ path: '', message: 'plan must be an object' }] };
  }
  const record = value as Record<string, unknown>;
  for (const banned of ['js', 'script', 'hooks', 'eval']) {
    if (banned in record) {
      issues.push({ path: banned, message: 'executable plan fields are not allowed' });
    }
  }

  const id = asNonEmptyString(record.id);
  if (!id) issues.push({ path: 'id', message: 'id is required' });
  const sessionId = asNonEmptyString(record.sessionId);
  if (!sessionId) issues.push({ path: 'sessionId', message: 'sessionId is required' });
  const projectPath = asNonEmptyString(record.projectPath);
  if (!projectPath) issues.push({ path: 'projectPath', message: 'projectPath is required' });
  const title = asNonEmptyString(record.title);
  if (!title) issues.push({ path: 'title', message: 'title is required' });
  const goal = asNonEmptyString(record.goal);
  if (!goal) issues.push({ path: 'goal', message: 'goal is required' });
  const status = record.status;
  if (typeof status !== 'string' || !PLAN_STATUSES.has(status as PlanStatus)) {
    issues.push({ path: 'status', message: 'invalid status' });
  }
  const source = record.source;
  if (typeof source !== 'string' || !SOURCES.has(source as PlanSource)) {
    issues.push({ path: 'source', message: 'invalid source' });
  }
  const revision = record.revision;
  if (typeof revision !== 'number' || !Number.isFinite(revision) || revision < 0) {
    issues.push({ path: 'revision', message: 'revision must be a non-negative number' });
  }
  const createdAt = asNonEmptyString(record.createdAt);
  if (!createdAt) issues.push({ path: 'createdAt', message: 'createdAt is required' });
  const updatedAt = asNonEmptyString(record.updatedAt);
  if (!updatedAt) issues.push({ path: 'updatedAt', message: 'updatedAt is required' });

  if (!Array.isArray(record.steps)) {
    issues.push({ path: 'steps', message: 'steps must be an array' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const rawSteps = record.steps as unknown[];
  if (rawSteps.length > MAX_PLAN_STEPS) {
    issues.push({
      path: 'steps',
      message: `plan exceeds ${MAX_PLAN_STEPS} steps`,
    });
  }

  const steps: PlanStep[] = [];
  const seenStepIds = new Set<string>();
  for (let index = 0; index < rawSteps.length; index += 1) {
    const rawStep = rawSteps[index];
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      issues.push({ path: `steps[${index}]`, message: 'step must be an object' });
      continue;
    }
    const stepRecord = rawStep as Record<string, unknown>;
    const stepId = asNonEmptyString(stepRecord.id);
    const stepTitle = asNonEmptyString(stepRecord.title);
    const stepStatus = stepRecord.status;
    if (!stepId || !stepTitle) {
      issues.push({ path: `steps[${index}]`, message: 'id and title required' });
      continue;
    }
    if (seenStepIds.has(stepId)) {
      issues.push({ path: `steps[${index}].id`, message: `duplicate step id: ${stepId}` });
      continue;
    }
    seenStepIds.add(stepId);
    if (typeof stepStatus !== 'string' || !STEP_STATUSES.has(stepStatus as PlanStepStatus)) {
      issues.push({ path: `steps[${index}].status`, message: 'invalid status' });
      continue;
    }
    const step: PlanStep = {
      id: stepId,
      title: stepTitle,
      status: stepStatus as PlanStepStatus,
    };
    const detail = asNonEmptyString(stepRecord.detail);
    if (detail) {
      step.detail = detail;
    }
    steps.push(step);
  }

  // Optional metadata: skillId, complexity, independentSteps, execution.
  const skillId = asNonEmptyString(record.skillId);
  const complexityRaw = record.complexity;
  let complexity: PlanComplexity | undefined;
  if (complexityRaw !== undefined) {
    if (typeof complexityRaw !== 'string' || !COMPLEXITIES.has(complexityRaw as PlanComplexity)) {
      issues.push({ path: 'complexity', message: 'invalid complexity' });
    } else {
      complexity = complexityRaw as PlanComplexity;
    }
  }

  const independentStepsRaw = record.independentSteps;
  let independentSteps: string[] | undefined;
  if (independentStepsRaw !== undefined) {
    if (!Array.isArray(independentStepsRaw)) {
      issues.push({ path: 'independentSteps', message: 'independentSteps must be an array' });
    } else {
      if (independentStepsRaw.length > MAX_PLAN_INDEPENDENT_STEPS) {
        issues.push({
          path: 'independentSteps',
          message: `independentSteps exceeds ${MAX_PLAN_INDEPENDENT_STEPS}`,
        });
      }
      const ids: string[] = [];
      const seenIndependent = new Set<string>();
      for (let index = 0; index < independentStepsRaw.length; index += 1) {
        const entry = independentStepsRaw[index];
        const entryId = asNonEmptyString(entry);
        if (!entryId) {
          issues.push({
            path: `independentSteps[${index}]`,
            message: 'must be a non-empty string',
          });
          continue;
        }
        if (!seenStepIds.has(entryId)) {
          issues.push({
            path: `independentSteps[${index}]`,
            message: `unknown step id: ${entryId}`,
          });
          continue;
        }
        if (seenIndependent.has(entryId)) {
          issues.push({
            path: `independentSteps[${index}]`,
            message: `duplicate independent step id: ${entryId}`,
          });
          continue;
        }
        seenIndependent.add(entryId);
        ids.push(entryId);
      }
      if (ids.length > 0) independentSteps = ids;
    }
  }

  const executionRaw = record.execution;
  let execution: PlanExecutionState | undefined;
  if (executionRaw !== undefined) {
    const execResult = validateExecutionState(executionRaw);
    if (!execResult.ok) {
      for (const issue of execResult.issues) {
        issues.push({ path: `execution.${issue.path}`, message: issue.message });
      }
    } else {
      execution = execResult.state;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const validated: SessionPlan = {
    id: id!,
    sessionId: sessionId!,
    projectPath: projectPath!,
    status: status as PlanStatus,
    title: title!,
    goal: goal!,
    steps,
    revision: revision as number,
    createdAt: createdAt!,
    updatedAt: updatedAt!,
    source: source as PlanSource,
  };
  if (skillId) validated.skillId = skillId;
  if (complexity) validated.complexity = complexity;
  if (independentSteps) validated.independentSteps = independentSteps;
  if (execution) validated.execution = execution;
  return { ok: true, plan: validated };
}

type ExecutionValidationResult =
  { ok: true; state: PlanExecutionState } | { ok: false; issues: PlanValidationIssue[] };

function validateExecutionState(value: unknown): ExecutionValidationResult {
  const issues: PlanValidationIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [{ path: '', message: 'execution must be an object' }] };
  }
  const record = value as Record<string, unknown>;
  const sessionId = asNonEmptyString(record.sessionId);
  if (!sessionId) issues.push({ path: 'sessionId', message: 'sessionId is required' });
  const planId = asNonEmptyString(record.planId);
  if (!planId) issues.push({ path: 'planId', message: 'planId is required' });
  const mode = record.mode;
  if (typeof mode !== 'string' || !EXECUTION_MODES.has(mode as PlanExecutionState['mode'])) {
    issues.push({ path: 'mode', message: 'invalid execution mode' });
  }
  const status = record.status;
  if (typeof status !== 'string' || !EXECUTION_STATUSES.has(status as PlanExecutionStatus)) {
    issues.push({ path: 'status', message: 'invalid execution status' });
  }
  const childSessionIdsRaw = record.childSessionIds;
  let childSessionIds: string[] = [];
  if (childSessionIdsRaw === undefined) {
    childSessionIds = [];
  } else if (!Array.isArray(childSessionIdsRaw)) {
    issues.push({ path: 'childSessionIds', message: 'childSessionIds must be an array' });
  } else {
    childSessionIds = childSessionIdsRaw.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  const currentStepId = asNonEmptyString(record.currentStepId);
  const error = asNonEmptyString(record.error);
  const startedAt = asNonEmptyString(record.startedAt);
  const endedAt = asNonEmptyString(record.endedAt);
  if (issues.length > 0) return { ok: false, issues };
  const state: PlanExecutionState = {
    sessionId: sessionId!,
    planId: planId!,
    mode: mode as PlanExecutionState['mode'],
    status: status as PlanExecutionStatus,
    childSessionIds,
  };
  if (currentStepId) state.currentStepId = currentStepId;
  if (error) state.error = error;
  if (startedAt) state.startedAt = startedAt;
  if (endedAt) state.endedAt = endedAt;
  return { ok: true, state };
}

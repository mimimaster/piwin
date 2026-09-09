/**
 * Validate session plan artifacts (size + shape; no executable fields).
 */
import type {
  PlanComplexity,
  PlanExecutionSummary,
  PlanExecutionState,
  PlanExecutionStatus,
  PlanSource,
  PlanStatus,
  PlanStep,
  PlanStepStatus,
  SessionPlan,
} from '@piwin/contracts';
import { Buffer } from 'node:buffer';
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
  const encoded = JSON.stringify(value ?? null, null, 2);
  if (
    encoded === undefined ||
    Buffer.byteLength(`${encoded}\n`, 'utf8') > MAX_PLAN_JSON_BYTES
  ) {
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
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    issues.push({ path: 'revision', message: 'revision must be a non-negative integer' });
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
    // CE-SUB-PROF: optional profileId
    const profileId = asNonEmptyString(stepRecord.profileId);
    if (profileId) step.profileId = profileId;
    // CE-SUB-ORCH: optional parallelGroup
    const parallelGroup = asNonEmptyString(stepRecord.parallelGroup);
    if (parallelGroup) step.parallelGroup = parallelGroup;
    // CE-SUB-ORCH: optional dependsOn (validated after all step ids are known)
    const dependsOnRaw = stepRecord.dependsOn;
    if (dependsOnRaw !== undefined) {
      if (!Array.isArray(dependsOnRaw)) {
        issues.push({ path: `steps[${index}].dependsOn`, message: 'dependsOn must be an array' });
      } else {
        const deps: string[] = [];
        for (let depIndex = 0; depIndex < dependsOnRaw.length; depIndex += 1) {
          const depId = asNonEmptyString(dependsOnRaw[depIndex]);
          if (!depId) {
            issues.push({
              path: `steps[${index}].dependsOn[${depIndex}]`,
              message: 'must be a non-empty string',
            });
            continue;
          }
          if (depId === stepId) {
            issues.push({
              path: `steps[${index}].dependsOn[${depIndex}]`,
              message: 'self-dependency is not allowed',
            });
            continue;
          }
          deps.push(depId);
        }
        if (deps.length > 0) step.dependsOn = deps;
      }
    }
    steps.push(step);
  }

  // CE-SUB-ORCH: validate that all dependsOn reference known step ids and
  // detect cycles. Self-dependencies are already caught above.
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (!step.dependsOn) continue;
    for (const depId of step.dependsOn) {
      if (!seenStepIds.has(depId)) {
        issues.push({
          path: `steps[${index}].dependsOn`,
          message: `unknown step id: ${depId}`,
        });
      }
    }
  }
  // Cycle detection via DFS.
  if (issues.length === 0) {
    const cycleErrors = detectPlanCycles(steps);
    for (const error of cycleErrors) {
      issues.push({ path: 'steps', message: error });
    }
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
  const runId = asNonEmptyString(record.runId);
  const error = asNonEmptyString(record.error);
  const startedAt = asNonEmptyString(record.startedAt);
  const endedAt = asNonEmptyString(record.endedAt);
  const summaryResult =
    record.summary === undefined ? undefined : validateExecutionSummary(record.summary);
  if (summaryResult && !summaryResult.ok) {
    for (const issue of summaryResult.issues) {
      issues.push({ path: `summary.${issue.path}`, message: issue.message });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  const state: PlanExecutionState = {
    sessionId: sessionId!,
    planId: planId!,
    mode: mode as PlanExecutionState['mode'],
    status: status as PlanExecutionStatus,
    childSessionIds,
  };
  if (runId) state.runId = runId;
  if (currentStepId) state.currentStepId = currentStepId;
  if (error) state.error = error;
  if (startedAt) state.startedAt = startedAt;
  if (endedAt) state.endedAt = endedAt;
  if (summaryResult?.ok) state.summary = summaryResult.summary;
  return { ok: true, state };
}

type ExecutionSummaryValidationResult =
  | { ok: true; summary: PlanExecutionSummary }
  | { ok: false; issues: PlanValidationIssue[] };

function validateExecutionSummary(value: unknown): ExecutionSummaryValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [{ path: '', message: 'summary must be an object' }] };
  }
  const record = value as Record<string, unknown>;
  const issues: PlanValidationIssue[] = [];
  const planId = asNonEmptyString(record.planId);
  if (!planId) issues.push({ path: 'planId', message: 'planId is required' });
  const mode = record.mode;
  if (typeof mode !== 'string' || !EXECUTION_MODES.has(mode as PlanExecutionState['mode'])) {
    issues.push({ path: 'mode', message: 'invalid execution mode' });
  }
  const completedStepIds = validateSummaryStringArray(
    record.completedStepIds,
    'completedStepIds',
    issues,
  );
  const failedStepIds = validateSummaryStringArray(
    record.failedStepIds,
    'failedStepIds',
    issues,
  );
  const skippedStepIds = validateSummaryStringArray(
    record.skippedStepIds,
    'skippedStepIds',
    issues,
  );
  const mergedChildSessionIds = validateSummaryStringArray(
    record.mergedChildSessionIds,
    'mergedChildSessionIds',
    issues,
  );
  const unresolvedItems =
    record.unresolvedItems === undefined
      ? undefined
      : validateSummaryStringArray(record.unresolvedItems, 'unresolvedItems', issues);
  const verificationResult = asNonEmptyString(record.verificationResult);
  const startedAt = asNonEmptyString(record.startedAt);
  const endedAt = asNonEmptyString(record.endedAt);
  if (issues.length > 0 || !planId || typeof mode !== 'string') {
    return { ok: false, issues };
  }
  return {
    ok: true,
    summary: {
      planId,
      mode: mode as PlanExecutionState['mode'],
      completedStepIds,
      failedStepIds,
      skippedStepIds,
      mergedChildSessionIds,
      ...(verificationResult ? { verificationResult } : {}),
      ...(unresolvedItems ? { unresolvedItems } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
    },
  };
}

function validateSummaryStringArray(
  value: unknown,
  path: string,
  issues: PlanValidationIssue[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: `${path} must be an array` });
    return [];
  }
  const values: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = asNonEmptyString(value[index]);
    if (!entry) {
      issues.push({ path: `${path}[${index}]`, message: 'must be a non-empty string' });
    } else {
      values.push(entry);
    }
  }
  return values;
}

/**
 * CE-SUB-ORCH: detect cycles in the plan step dependency graph.
 * Returns an array of error messages (empty if no cycles).
 */
function detectPlanCycles(steps: PlanStep[]): string[] {
  const errors: string[] = [];
  const stepMap = new Map<string, PlanStep>();
  for (const step of steps) stepMap.set(step.id, step);

  const WHITE = 0; // unvisited
  const GRAY = 1; // in progress (on current DFS path)
  const BLACK = 2; // fully processed
  const color = new Map<string, number>();
  for (const step of steps) color.set(step.id, WHITE);

  function dfs(stepId: string, path: string[]): boolean {
    color.set(stepId, GRAY);
    const step = stepMap.get(stepId);
    if (step?.dependsOn) {
      for (const dep of step.dependsOn) {
        const depColor = color.get(dep);
        if (depColor === GRAY) {
          errors.push(`dependency cycle detected: ${[...path, stepId, dep].join(' → ')}`);
          return true;
        }
        if (depColor === WHITE) {
          if (dfs(dep, [...path, stepId])) return true;
        }
      }
    }
    color.set(stepId, BLACK);
    return false;
  }

  for (const step of steps) {
    if (color.get(step.id) === WHITE) {
      dfs(step.id, []);
    }
  }

  return errors;
}

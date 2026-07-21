/**
 * Validate session plan artifacts (size + shape; no executable fields).
 */
import type { PlanSource, PlanStatus, PlanStep, PlanStepStatus, SessionPlan } from '@piwin/contracts';
import { MAX_PLAN_JSON_BYTES } from '@piwin/contracts';

const PLAN_STATUSES = new Set<PlanStatus>([
  'draft',
  'approved',
  'executing',
  'done',
  'abandoned',
]);
const STEP_STATUSES = new Set<PlanStepStatus>(['pending', 'active', 'done', 'skipped']);
const SOURCES = new Set<PlanSource>(['user', 'assistant', 'skill']);

export type PlanValidationIssue = { path: string; message: string };

export type PlanValidationResult =
  | { ok: true; plan: SessionPlan }
  | { ok: false; issues: PlanValidationIssue[] };

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

  const steps: PlanStep[] = [];
  for (let index = 0; index < (record.steps as unknown[]).length; index += 1) {
    const rawStep = (record.steps as unknown[])[index];
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

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    plan: {
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
    },
  };
}

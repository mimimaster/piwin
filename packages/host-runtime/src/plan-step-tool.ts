/**
 * Host custom tool: piwin_plan_set_step — model-facing plan progress (SDK only).
 * RPC mode cannot register custom tools (ADR 0008).
 */
import type { PlanStepStatus, SessionPlan } from '@piwin/contracts';
import {
  applyPlanStepUpdate,
  loadSessionPlan,
  saveSessionPlan,
  MAX_PLAN_STEP_NOTE_CHARS,
} from '@piwin/session';
import type { HostToolDefinition } from '@piwin/tools-web';

const STEP_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'active',
  'done',
  'skipped',
]);

export type PlanStepToolOptions = {
  sessionId: string;
  planPath: string;
  onUpdated?: (plan: SessionPlan) => void;
};

export function createPlanStepTool(options: PlanStepToolOptions): HostToolDefinition {
  return {
    name: 'piwin_plan_set_step',
    description:
      'Update plan step status (pending|active|done|skipped). ' +
      'Mark done only when acceptance criteria are met; put verification evidence in note.',
    parameters: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: 'Plan step id' },
        status: {
          type: 'string',
          description: 'pending | active | done | skipped',
        },
        note: {
          type: 'string',
          description: `Optional short note (max ${MAX_PLAN_STEP_NOTE_CHARS} chars)`,
        },
      },
      required: ['stepId', 'status'],
    },
    async execute(args) {
      const stepId = String(args.stepId ?? '').trim();
      const statusRaw = String(args.status ?? '').trim();
      if (!stepId) {
        return 'error: stepId is required';
      }
      if (!STEP_STATUSES.has(statusRaw)) {
        return `error: invalid status ${statusRaw}`;
      }
      const status = statusRaw as PlanStepStatus;
      const plan = await loadSessionPlan(options.planPath);
      if (!plan) {
        return 'error: no plan for this session';
      }
      if (plan.status !== 'approved' && plan.status !== 'executing') {
        return `error: plan status is ${plan.status}; only approved|executing allow tool updates`;
      }
      const detail =
        typeof args.note === 'string' ? args.note.slice(0, MAX_PLAN_STEP_NOTE_CHARS) : undefined;
      const result = applyPlanStepUpdate({
        plan,
        stepId,
        status,
        ...(detail !== undefined ? { detail } : {}),
      });
      if (!result.ok) {
        return `error: ${result.error}`;
      }
      await saveSessionPlan(options.planPath, result.plan);
      options.onUpdated?.(result.plan);
      return `ok: step ${stepId} → ${status}; plan status ${result.plan.status} (rev ${result.plan.revision})`;
    },
  };
}

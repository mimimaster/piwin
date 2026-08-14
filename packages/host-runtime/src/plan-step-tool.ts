/**
 * Host custom tool: piwin_plan_set_step — model-facing plan progress (SDK only).
 * SDK registers it directly; the piwin RPC worker proxies the same Host tool.
 */
import type {
  HostToolRegistration,
  PlanStepStatus,
  SessionPlan,
  ToolResult,
} from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import {
  applyPlanStepUpdate,
  loadSessionPlan,
  saveSessionPlan,
  MAX_PLAN_STEP_NOTE_CHARS,
} from '@piwin/session';

const STEP_STATUSES: ReadonlySet<string> = new Set(['pending', 'active', 'done', 'skipped']);

export type PlanStepToolOptions = {
  sessionId: string;
  planPath: string;
  onUpdated?: (plan: SessionPlan) => void;
};

function invalidPlanInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

export function createPlanStepTool(options: PlanStepToolOptions): HostToolRegistration {
  return {
    descriptor: {
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
    },
    family: 'planning',
    permissionSpec: {
      action: 'planning:update',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'planning:update' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args) {
      const stepId = String(args.stepId ?? '').trim();
      const statusRaw = String(args.status ?? '').trim();
      if (!stepId) {
        return invalidPlanInput('stepId is required');
      }
      if (!STEP_STATUSES.has(statusRaw)) {
        return invalidPlanInput(`invalid status ${statusRaw}`);
      }
      const status = statusRaw as PlanStepStatus;
      const plan = await loadSessionPlan(options.planPath);
      if (!plan) {
        return invalidPlanInput('no plan for this session');
      }
      if (plan.status !== 'approved' && plan.status !== 'executing') {
        return invalidPlanInput(
          `plan status is ${plan.status}; only approved|executing allow tool updates`,
        );
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
        return invalidPlanInput(result.error);
      }
      await saveSessionPlan(options.planPath, result.plan);
      options.onUpdated?.(result.plan);
      return {
        ok: true,
        output: `step ${stepId} → ${status}; plan status ${result.plan.status} (rev ${result.plan.revision})`,
        details: {
          planId: result.plan.id,
          revision: result.plan.revision,
          stepId,
          status,
        },
      };
    },
  };
}

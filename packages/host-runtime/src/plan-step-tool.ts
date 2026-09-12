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
  PlanMutationError,
  updateSessionPlan,
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
        'Update execution status of a plan step (pending | active | done | skipped). ' +
        'The plan must already be approved or executing. If the tool says the ' +
        'execution mode is not chosen, ask the user and do not retry. ' +
        'Mark done ONLY after verifying concrete evidence (test/build passing). ' +
        'Document empirical verification results in note.',
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
      const detail =
        typeof args.note === 'string' ? args.note.slice(0, MAX_PLAN_STEP_NOTE_CHARS) : undefined;
      let plan;
      try {
        plan = await updateSessionPlan(options.planPath, (current) => {
          if (!current) {
            throw new PlanMutationError('no plan for this session');
          }
          if (current.status === 'draft') {
            throw new PlanMutationError(
              '尚未选择执行方式；请先确认当前会话执行还是子代理执行，不要重试本工具。',
            );
          }
          if (current.status !== 'approved' && current.status !== 'executing') {
            throw new PlanMutationError(
              `plan status is ${current.status}; only approved|executing allow tool updates`,
            );
          }
          const result = applyPlanStepUpdate({
            plan: current,
            stepId,
            status,
            ...(detail !== undefined ? { detail } : {}),
          });
          if (!result.ok) {
            throw new PlanMutationError(result.error);
          }
          return result.plan;
        });
      } catch (error) {
        if (error instanceof PlanMutationError) {
          return invalidPlanInput(error.message);
        }
        throw error;
      }
      if (!plan) {
        return invalidPlanInput('no plan for this session');
      }
      options.onUpdated?.(plan);
      return {
        ok: true,
        output: `step ${stepId} → ${status}; plan status ${plan.status} (rev ${plan.revision})`,
        details: {
          planId: plan.id,
          revision: plan.revision,
          stepId,
          status,
        },
      };
    },
  };
}

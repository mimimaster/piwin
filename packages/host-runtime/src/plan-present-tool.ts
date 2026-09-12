/**
 * Host custom tool: piwin_plan_present — display payload for the execution card.
 *
 * Create persists the draft. This tool only lifts the saved plan into a
 * plan-display payload so Desktop can render the A/B picker. It does not
 * change plan status or execution rights.
 */
import type { HostToolRegistration, SessionPlan, ToolResult } from '@piwin/contracts';
import { loadSessionPlan } from '@piwin/session';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';

export type PlanPresentToolOptions = {
  sessionId: string;
  planPath: string;
};

function invalidPlanInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

function canPresentPlan(plan: SessionPlan): boolean {
  const executionStatus = plan.execution?.status;
  if (executionStatus === 'running' || executionStatus === 'queued') return false;
  return plan.status === 'draft' || plan.status === 'approved';
}

export function createPlanPresentTool(options: PlanPresentToolOptions): HostToolRegistration {
  return {
    descriptor: {
      name: 'piwin_plan_present',
      description:
        'Show the current draft or approved plan as execution-choice display data. ' +
        'This does not change plan status or execution rights. Desktop may render a picker card from the payload.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    family: 'planning',
    permissionSpec: {
      action: 'planning:create',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'planning:create' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute() {
      const plan = await loadSessionPlan(options.planPath);
      if (!plan) {
        return invalidPlanInput('no draft plan to present; call piwin_plan_create first');
      }
      if (!canPresentPlan(plan)) {
        return invalidPlanInput(
          `plan status is ${plan.status}; only a reviewable draft or approved plan can be presented`,
        );
      }
      const displayPath = `plans/${options.sessionId}.md`;
      return {
        ok: true,
        output:
          `Plan display ready (${plan.steps.length} steps). ` +
          `Open in Piwin as ${displayPath}. Plan status is unchanged.` +
          (plan.status === 'draft' ? ' 尚未选择执行方式。' : ''),
        details: {
          planId: plan.id,
          revision: plan.revision,
          status: plan.status,
          planDisplay: {
            version: 1 as const,
            path: options.planPath,
            displayPath,
            plan,
          },
        },
      };
    },
  };
}

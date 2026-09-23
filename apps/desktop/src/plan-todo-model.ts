/**
 * Claude Code TodoWrite display rules, mapped onto SessionPlan.
 *
 * Locked from CC's shipped TUI (Boris 2025-09 + docs/llms-full.txt):
 * - Hide plan-progress tool rows; one live list sits above the input.
 * - Compact view shows at most 5 steps, windowed around the first open item.
 * - Hide the list once every step is done/skipped (CC tray vanishes when complete).
 * - Conversation sessions never show this surface (existing piwin rule).
 */
import type { PlanStep, SessionPlan } from '@piwin/contracts';
import type { ToolCardUi } from './chat-ui-types.js';

export const PLAN_TODO_COMPACT_LIMIT = 5;

const PLAN_PROGRESS_TOOL_NAMES = new Set([
  'piwin_plan_create',
  'piwin_plan_present',
  'piwin_plan_set_step',
  'plan_create',
  'plan_present',
  'plan_set_step',
]);

export function isPlanProgressToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return PLAN_PROGRESS_TOOL_NAMES.has(toolName.trim().toLowerCase());
}

export function isPlanProgressTool(tool: Pick<ToolCardUi, 'toolName' | 'presentation'>): boolean {
  return (
    isPlanProgressToolName(tool.toolName) || isPlanProgressToolName(tool.presentation?.routedToolName)
  );
}

/** What the todo tray can ask the Host to do with the plan. */
export type PlanTrayAction = 'abort' | 'complete' | 'dismiss';

/**
 * A Host-driven execution is actually in flight. `plan.status === 'executing'`
 * alone is not enough: a plan the agent works through inline, or one left
 * mid-way when the turn ended, stays `executing` with an idle execution, and
 * `plan/abort` rejects it ("plan is not running").
 */
export function isPlanExecutionLive(plan: Pick<SessionPlan, 'execution'>): boolean {
  const status = plan.execution?.status;
  return status === 'running' || status === 'queued';
}

export function planHasOpenSteps(plan: Pick<SessionPlan, 'steps'>): boolean {
  return plan.steps.some((step) => step.status === 'pending' || step.status === 'active');
}

export function shouldShowPlanTodoTray(input: {
  plan: SessionPlan | null | undefined;
  isConversationSession: boolean;
}): boolean {
  if (input.isConversationSession) return false;
  const plan = input.plan;
  if (!plan || plan.steps.length === 0) return false;
  if (plan.status === 'done' || plan.status === 'abandoned') return false;
  // Draft/approved wait on the call-chain execution gate (proto-01 #13).
  if (plan.status === 'draft' || plan.status === 'approved') return false;
  const executionStatus = plan.execution?.status;
  if (executionStatus === 'failed' || executionStatus === 'aborted') return false;
  return planHasOpenSteps(plan);
}

export type CompactPlanSteps = {
  visible: PlanStep[];
  hiddenCount: number;
  startIndex: number;
};

/**
 * Up to 5 steps, starting at the first open item (one completed predecessor
 * when it exists, matching CC's "what's next" window rather than always 0..4).
 */
export function compactPlanSteps(
  steps: readonly PlanStep[],
  expanded: boolean,
): CompactPlanSteps {
  if (expanded || steps.length <= PLAN_TODO_COMPACT_LIMIT) {
    return { visible: [...steps], hiddenCount: 0, startIndex: 0 };
  }
  const firstOpen = steps.findIndex((step) => step.status === 'pending' || step.status === 'active');
  const focus = firstOpen < 0 ? 0 : firstOpen;
  const preferredStart = focus > 0 ? focus - 1 : focus;
  const maxStart = Math.max(0, steps.length - PLAN_TODO_COMPACT_LIMIT);
  const startIndex = Math.min(preferredStart, maxStart);
  const visible = steps.slice(startIndex, startIndex + PLAN_TODO_COMPACT_LIMIT);
  return {
    visible,
    hiddenCount: steps.length - visible.length,
    startIndex,
  };
}

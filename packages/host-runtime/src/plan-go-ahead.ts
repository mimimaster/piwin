/**
 * Draft-plan go-ahead wording shared by the planning tools.
 *
 * A draft waits for the user, not for a mode: inline and subagent-driven are
 * shortcuts on the card, and any other instruction ("只做前两步", "用 worktree
 * 并行") is an equally valid way to start.
 */
import type { SessionPlan } from '@piwin/contracts';

/** Appended to create/present results while the plan is still a draft. */
export const DRAFT_PLAN_GO_AHEAD_NOTICE =
  '计划尚未开始执行；等待用户确认。用户可以用任意方式执行（当前会话、子代理或其他自定义方式），按用户的说法执行即可，不要要求用户在固定选项中选择。';

/**
 * Approve a draft so step progress can be recorded. The user's go-ahead is
 * the approval; no execution mode is required or implied.
 */
export function approveDraftPlanForExecution(plan: SessionPlan): SessionPlan {
  if (plan.status !== 'draft') return plan;
  return { ...plan, status: 'approved' };
}

import type { SelectItem } from '@earendil-works/pi-tui';
import type { PlanExecutionState, PlanStep, SessionPlan } from '@piwin/contracts';

/**
 * How a session plan reads in the TUI and what can be done with it at each
 * stage. Pure — tui-plan-controller sends the commands.
 */

export type PlanAction =
  | 'execute-inline'
  | 'execute-subagents'
  | 'approve'
  | 'abandon'
  | 'abort'
  | 'clear'
  | 'close';

const STEP_GLYPH: Record<PlanStep['status'], string> = {
  pending: '○',
  active: '◐',
  done: '●',
  skipped: '⊘',
};

const STATUS_LABEL: Record<SessionPlan['status'], string> = {
  draft: '草稿',
  approved: '已批准',
  executing: '执行中',
  done: '已完成',
  abandoned: '已放弃',
};

const EXECUTION_LABEL: Record<PlanExecutionState['status'], string> = {
  idle: '未开始',
  queued: '排队中',
  running: '执行中',
  completed: '执行完成',
  failed: '执行失败',
  aborted: '已中止',
};

function isExecuting(plan: SessionPlan): boolean {
  const execution = plan.execution?.status;
  return plan.status === 'executing' || execution === 'running' || execution === 'queued';
}

export function planProgress(plan: SessionPlan): { settled: number; total: number } {
  return {
    settled: plan.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length,
    total: plan.steps.length,
  };
}

/** Status-line part; a plan that is over no longer takes space there. */
export function describePlan(plan: SessionPlan | null): string | undefined {
  if (plan === null || plan.status === 'abandoned') return undefined;
  const { settled, total } = planProgress(plan);
  if (plan.execution?.status === 'failed') return `计划 ${settled}/${total} · 执行失败`;
  if (plan.status === 'done') return undefined;
  return `计划 ${settled}/${total} · ${isExecuting(plan) ? '执行中' : STATUS_LABEL[plan.status]}`;
}

/** The plan as text for the overlay body. */
export function renderPlanText(plan: SessionPlan): string {
  const lines = [`${plan.title}（${STATUS_LABEL[plan.status]}）`];
  if (plan.goal.trim().length > 0) lines.push(`目标：${plan.goal.trim()}`);
  lines.push('');
  const independent = new Set(plan.independentSteps ?? []);
  plan.steps.forEach((step, index) => {
    const current = plan.execution?.currentStepId === step.id ? ' ←' : '';
    const parallel = independent.has(step.id) ? ' ∥' : '';
    lines.push(`${STEP_GLYPH[step.status]} ${index + 1}. ${step.title}${parallel}${current}`);
    if (step.detail !== undefined && step.detail.trim().length > 0) lines.push(`     ${step.detail.trim()}`);
  });
  const execution = plan.execution;
  if (execution !== undefined && execution.status !== 'idle') {
    lines.push('');
    const mode = execution.mode === 'subagent-driven' ? '子代理' : '当前会话';
    const children = execution.childSessionIds.length > 0 ? ` · ${execution.childSessionIds.length} 个子会话` : '';
    lines.push(`${EXECUTION_LABEL[execution.status]}（${mode}${children}）`);
    if (execution.error !== undefined) lines.push(`原因：${execution.error}`);
  }
  if (independent.size > 0) lines.push('', '∥ 可交给子代理并行');
  return lines.join('\n');
}

/** What the user may do with the plan now, most likely action first. */
export function planActionItems(plan: SessionPlan): SelectItem[] {
  const item = (value: PlanAction, label: string, description?: string): SelectItem => ({
    value,
    label,
    ...(description === undefined ? {} : { description }),
  });
  const close = item('close', '关闭');
  if (isExecuting(plan)) return [item('abort', '中止执行'), close];
  if (plan.status === 'draft' || plan.status === 'approved') {
    const approve = plan.status === 'draft';
    const verb = approve ? '批准并执行' : '执行';
    const subagents = item('execute-subagents', `${verb}（子代理）`, '每步交给隔离的子会话');
    const inline = item('execute-inline', `${verb}（当前会话）`, '在这个会话里逐步完成');
    // The Host marks long plans; those are the ones worth delegating.
    const ordered = plan.complexity === 'long' ? [subagents, inline] : [inline, subagents];
    return [
      ...ordered,
      ...(approve ? [item('approve', '仅批准', '稍后再执行')] : []),
      item('abandon', '放弃这个计划'),
      close,
    ];
  }
  return [item('clear', '清除计划'), close];
}

/** A line for the transcript when a plan appears or reaches a new stage. */
export function describePlanChange(previous: SessionPlan | null, next: SessionPlan | null): string | undefined {
  if (next === null) return previous === null ? undefined : '计划已清除';
  const isNew = previous === null || previous.id !== next.id;
  if (isNew && next.status === 'draft') {
    return `计划已生成：${next.title}（${next.steps.length} 步）· /plan 查看并执行`;
  }
  if (previous !== null && !isNew && previous.revision !== next.revision && next.status === 'draft') {
    return `计划已更新：${next.title} · /plan 查看`;
  }
  const before = isNew ? undefined : previous?.execution?.status;
  const after = next.execution?.status;
  if (after !== before && (after === 'completed' || after === 'failed' || after === 'aborted')) {
    const reason = after === 'failed' && next.execution?.error !== undefined ? `：${next.execution.error}` : '';
    return `计划${EXECUTION_LABEL[after]}${reason}`;
  }
  return undefined;
}

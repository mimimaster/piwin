import type { PlanExecutionState, SessionPlan } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { describePlan, describePlanChange, planActionItems, planProgress, renderPlanText } from './plan-view.js';

function plan(patch: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'plan-1',
    sessionId: 's1',
    projectPath: '',
    status: 'draft',
    title: '重构登录',
    goal: '拆掉旧的会话存储',
    steps: [
      { id: 'a', title: '梳理调用点', status: 'done' },
      { id: 'b', title: '替换存储', status: 'active', detail: '先加适配层' },
      { id: 'c', title: '删旧代码', status: 'pending' },
    ],
    revision: 1,
    createdAt: '',
    updatedAt: '',
    source: 'assistant',
    ...patch,
  };
}

function execution(patch: Partial<PlanExecutionState>): PlanExecutionState {
  return { sessionId: 's1', planId: 'plan-1', mode: 'inline', status: 'running', childSessionIds: [], ...patch };
}

const actions = (value: SessionPlan): string[] => planActionItems(value).map((item) => item.value);

describe('plan status', () => {
  it('counts done and skipped steps as settled', () => {
    expect(planProgress(plan())).toEqual({ settled: 1, total: 3 });
  });

  it('shows a live plan in the status line and drops a finished or abandoned one', () => {
    expect(describePlan(plan())).toBe('计划 1/3 · 草稿');
    expect(describePlan(plan({ status: 'executing' }))).toBe('计划 1/3 · 执行中');
    expect(describePlan(plan({ status: 'approved', execution: execution({ status: 'failed' }) }))).toBe(
      '计划 1/3 · 执行失败',
    );
    expect(describePlan(plan({ status: 'done' }))).toBeUndefined();
    expect(describePlan(plan({ status: 'abandoned' }))).toBeUndefined();
    expect(describePlan(null)).toBeUndefined();
  });
});

describe('renderPlanText', () => {
  it('lists steps with their state, detail, the running step and parallel candidates', () => {
    const text = renderPlanText(
      plan({
        status: 'executing',
        independentSteps: ['c'],
        execution: execution({ mode: 'subagent-driven', currentStepId: 'b', childSessionIds: ['k1', 'k2'] }),
      }),
    );
    expect(text.split('\n')).toEqual([
      '重构登录（执行中）',
      '目标：拆掉旧的会话存储',
      '',
      '● 1. 梳理调用点',
      '◐ 2. 替换存储 ←',
      '     先加适配层',
      '○ 3. 删旧代码 ∥',
      '',
      '执行中（子代理 · 2 个子会话）',
      '',
      '∥ 可交给子代理并行',
    ]);
  });

  it('gives the reason a run failed', () => {
    expect(renderPlanText(plan({ execution: execution({ status: 'failed', error: '测试没过' }) }))).toContain(
      '执行失败（当前会话）\n原因：测试没过',
    );
  });
});

describe('planActionItems', () => {
  it('offers approval with execution for a draft, delegating first when the plan is long', () => {
    expect(actions(plan())).toEqual(['execute-inline', 'execute-subagents', 'approve', 'abandon', 'close']);
    expect(actions(plan({ complexity: 'long' }))[0]).toBe('execute-subagents');
    expect(planActionItems(plan())[0]?.label).toBe('批准并执行（当前会话）');
  });

  it('offers plain execution once approved', () => {
    expect(actions(plan({ status: 'approved' }))).toEqual(['execute-inline', 'execute-subagents', 'abandon', 'close']);
    expect(planActionItems(plan({ status: 'approved' }))[0]?.label).toBe('执行（当前会话）');
  });

  it('only lets a running plan be stopped and a finished one be cleared', () => {
    expect(actions(plan({ status: 'executing' }))).toEqual(['abort', 'close']);
    expect(actions(plan({ status: 'approved', execution: execution({ status: 'queued' }) }))).toEqual(['abort', 'close']);
    expect(actions(plan({ status: 'done' }))).toEqual(['clear', 'close']);
    expect(actions(plan({ status: 'abandoned' }))).toEqual(['clear', 'close']);
  });
});

describe('describePlanChange', () => {
  it('announces a new draft and a revised one', () => {
    expect(describePlanChange(null, plan())).toBe('计划已生成：重构登录（3 步）· /plan 查看并执行');
    expect(describePlanChange(plan(), plan({ revision: 2 }))).toBe('计划已更新：重构登录 · /plan 查看');
  });

  it('announces how an execution ended, once', () => {
    const running = plan({ status: 'executing', execution: execution({}) });
    const failed = plan({ status: 'approved', execution: execution({ status: 'failed', error: '测试没过' }) });
    expect(describePlanChange(running, failed)).toBe('计划执行失败：测试没过');
    expect(describePlanChange(failed, failed)).toBeUndefined();
    expect(describePlanChange(running, plan({ status: 'done', execution: execution({ status: 'completed' }) }))).toBe(
      '计划执行完成',
    );
  });

  it('stays quiet for step progress and says when a plan is cleared', () => {
    const running = plan({ status: 'executing', execution: execution({}) });
    expect(describePlanChange(running, plan({ status: 'executing', revision: 2, execution: execution({}) }))).toBeUndefined();
    expect(describePlanChange(plan(), null)).toBe('计划已清除');
    expect(describePlanChange(null, null)).toBeUndefined();
  });
});

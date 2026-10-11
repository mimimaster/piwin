import { describe, expect, it } from 'vitest';
import type { SubagentInvocation } from '@piwin/contracts';
import type { SubagentStreamState } from './chat-ui-types';
import {
  deriveSubagentInlineDetail,
  recentSubagentSteps,
  shouldShowSubagentSteps,
  SUBAGENT_INLINE_RECENT_STEPS,
} from './subagent-inline-view';

function invocation(patch: Partial<SubagentInvocation> = {}): SubagentInvocation {
  return {
    id: 'inv-1',
    parentSessionId: 'parent-1',
    runId: 'run-1',
    taskId: 'task-1',
    task: 'Review',
    status: 'running',
    activity: { kind: 'tool', toolName: 'read', title: 'read (policy.ts)' },
    revision: 1,
    createdAt: '2026-10-11T08:00:00.000Z',
    updatedAt: '2026-10-11T08:00:10.000Z',
    ...patch,
  };
}

const permissionTail = {
  permissionPrompt: { requestId: 'p1' },
} as unknown as SubagentStreamState;

describe('deriveSubagentInlineDetail', () => {
  it('matches the proto box for a running child with Host counters', () => {
    const detail = deriveSubagentInlineDetail({
      status: 'running',
      invocation: invocation({ usage: { toolCalls: 4, totalTokens: 9000, requests: 3 } }),
      locale: 'zh-CN',
    });
    expect(detail).toEqual({
      stepLabel: 'step 4 · 运行中',
      conclusion: '正在执行 read (policy.ts)',
      tone: 'live',
      toolCallsLabel: '4 次工具调用',
      retainedLabel: `保留最近 ${SUBAGENT_INLINE_RECENT_STEPS} 步`,
      openFullLabel: '打开完整会话 →',
    });
  });

  it('starts at step 1 and drops counter lines for an older Host', () => {
    expect(
      deriveSubagentInlineDetail({
        status: 'running',
        invocation: invocation({ usage: { toolCalls: 0, totalTokens: 0, requests: 0 } }),
        locale: 'zh-CN',
      }).stepLabel,
    ).toBe('step 1 · 运行中');
    const legacy = deriveSubagentInlineDetail({ status: 'running', invocation: invocation(), locale: 'zh-CN' });
    expect(legacy.stepLabel).toBe('运行中');
    expect(legacy.toolCallsLabel).toBeUndefined();
  });

  it('states the conclusion of a finished child from Host data', () => {
    const done = deriveSubagentInlineDetail({
      status: 'completed',
      invocation: invocation({ status: 'completed', activity: { kind: 'completed', summary: '权限改动无回归' } }),
      locale: 'zh-CN',
    });
    expect(done).toMatchObject({ conclusion: '已完成：权限改动无回归', tone: 'done' });
    const bare = deriveSubagentInlineDetail({ status: 'completed', locale: 'zh-CN' });
    expect(bare.conclusion).toBe('已完成。');
    const failed = deriveSubagentInlineDetail({
      status: 'failed',
      invocation: invocation({ status: 'failed', activity: { kind: 'failed', message: 'web_fetch 超时' } }),
      locale: 'zh-CN',
    });
    expect(failed).toMatchObject({ conclusion: '失败：web_fetch 超时', tone: 'failed' });
  });

  it('puts a pending permission ahead of the persisted activity', () => {
    const detail = deriveSubagentInlineDetail({
      status: 'running',
      invocation: invocation(),
      liveTail: permissionTail,
      locale: 'en',
    });
    expect(detail.conclusion).toBe('Waiting for permission');
  });
});

describe('inline steps', () => {
  it('keeps only the most recent steps', () => {
    const many = Array.from({ length: 25 }, (_, index) => index);
    expect(recentSubagentSteps(many)).toEqual(many.slice(5));
    expect(recentSubagentSteps([1, 2])).toEqual([1, 2]);
  });

  it('folds the steps unless the user opened them or a permission waits inside', () => {
    expect(shouldShowSubagentSteps({ userOpen: false, liveTail: null })).toBe(false);
    expect(shouldShowSubagentSteps({ userOpen: true })).toBe(true);
    expect(shouldShowSubagentSteps({ userOpen: false, liveTail: permissionTail })).toBe(true);
  });
});

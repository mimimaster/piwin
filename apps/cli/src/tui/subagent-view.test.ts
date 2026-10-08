import type { SubagentResultSummary } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  childActionItems,
  describeChildChange,
  describeSubagents,
  latestResultFor,
  needsDecision,
  subagentItems,
  toSubagentChild,
  type SubagentChild,
} from './subagent-view.js';

const allow = { allowed: true };
const deny = (reason: string) => ({ allowed: false, reason });

function result(patch: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'r1',
    revision: 1,
    parentSessionId: 'p',
    childSessionId: 'c1',
    integrationStatus: 'pending',
    reviewStatus: 'not-requested',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    childChanges: { changeSetId: 'cs', revision: 1 },
    appliedChanges: null,
    candidateGeneration: null,
    availability: { view: allow, apply: allow, resolve: deny('没有冲突'), cleanup: allow },
    ...patch,
  } as SubagentResultSummary;
}

const child = (patch: Partial<SubagentChild> & { sessionId: string }): SubagentChild => ({ name: patch.sessionId, ...patch });

describe('subagent overview', () => {
  it('reads the session id from either projection', () => {
    expect(toSubagentChild({ id: 'local', name: 'A' } as never)).toEqual({ sessionId: 'local', name: 'A' });
    expect(toSubagentChild({ id: 'x', sessionId: 'remote', subagentStatus: 'running' } as never)).toEqual({
      sessionId: 'remote',
      subagentStatus: 'running',
    });
  });

  it('counts only what still needs attention in the status line', () => {
    const children = [child({ sessionId: 'c1', subagentStatus: 'running' }), child({ sessionId: 'c2', subagentStatus: 'done' })];
    expect(describeSubagents(children, [result()])).toBe('子代理 1 运行中 · 1 个结果待处理');
    expect(describeSubagents([children[1] as SubagentChild], [result({ integrationStatus: 'applied' })])).toBeUndefined();
  });

  it('treats a result as open until its changes are applied or set aside', () => {
    expect(needsDecision(result())).toBe(true);
    expect(needsDecision(result({ integrationStatus: 'conflict' }))).toBe(true);
    expect(needsDecision(result({ integrationStatus: 'retained' }))).toBe(false);
    expect(needsDecision(result({ childChanges: null }))).toBe(false);
  });

  it('lists children with run and result state', () => {
    const items = subagentItems(
      [child({ sessionId: 'c1', name: '重构存储', subagentStatus: 'done' }), child({ sessionId: 'c2', subagentStatus: 'failed' })],
      [result({ reviewStatus: 'approved' })],
    );
    expect(items).toEqual([
      { value: 'c1', label: '重构存储', description: '已完成 · 待处理 · 评审通过' },
      { value: 'c2', label: 'c2', description: '失败' },
    ]);
  });

  it('picks the newest candidate of a child', () => {
    const picked = latestResultFor('c1', [
      result({ resultId: 'old', candidateGeneration: 1 }),
      result({ resultId: 'new', candidateGeneration: 2 }),
      result({ resultId: 'other', childSessionId: 'c2', candidateGeneration: 9 }),
    ]);
    expect(picked?.resultId).toBe('new');
  });
});

describe('childActionItems', () => {
  it('offers what the Host allows and explains what it refuses', () => {
    const items = childActionItems(result(), true);
    expect(items.map((item) => item.value)).toEqual(['files', 'apply', 'close', 'retain', 'discard', 'open-child', 'close']);
    expect(items[2]).toEqual({ value: 'close', label: '让主会话处理冲突（不可用）', description: '没有冲突' });
  });

  it('drops refused actions that come without a reason and retain once decided', () => {
    const decided = result({
      integrationStatus: 'applied',
      availability: { view: allow, apply: { allowed: false }, resolve: { allowed: false }, cleanup: allow },
    });
    expect(childActionItems(decided, false).map((item) => item.value)).toEqual(['files', 'discard', 'close']);
  });

  it('lets a finished child be given a follow-up, but not a running one', () => {
    expect(childActionItems(undefined, false, 'done').map((item) => item.value)).toEqual(['continue', 'close']);
    expect(childActionItems(undefined, false, 'failed').map((item) => item.value)).toEqual(['continue', 'close']);
    expect(childActionItems(undefined, false, 'running').map((item) => item.value)).toEqual(['close']);
  });

  it('still lets a child without a result be opened', () => {
    expect(childActionItems(undefined, true).map((item) => item.value)).toEqual(['open-child', 'close']);
    expect(childActionItems(undefined, false).map((item) => item.value)).toEqual(['close']);
  });
});

describe('describeChildChange', () => {
  it('announces a child ending, once, and stays quiet while it runs', () => {
    const running = child({ sessionId: 'c1', name: '重构存储', subagentStatus: 'running' });
    const done = { ...running, subagentStatus: 'done' as const };
    expect(describeChildChange(undefined, running)).toBeUndefined();
    expect(describeChildChange(running, done)).toBe('子代理「重构存储」已完成 · /subagents 查看');
    expect(describeChildChange(done, done)).toBeUndefined();
    expect(describeChildChange(running, { ...running, subagentStatus: 'failed' })).toContain('失败');
  });
});

import { describe, expect, it } from 'vitest';
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import type { SubagentStreamState, ToolCardUi } from '../conversation/chat-reducer';
import {
  areSubagentRowViewsEqual,
  deriveLegacySubagentRowView,
  deriveSubagentGroupSummary,
  deriveSubagentRowView,
  formatSubagentElapsed,
  resolveSubagentGroupExpanded,
  segmentSubagentRuns,
  type SubagentRowView,
} from './subagent-card-view';

const tool: ToolCardUi = {
  toolCallId: 'tool-1',
  toolName: 'piwin_subagent_run',
  status: 'running',
  output: '',
};

function invocation(patch: Partial<SubagentInvocation> = {}): SubagentInvocation {
  return {
    id: 'inv-1',
    parentSessionId: 'parent-1',
    runId: 'run-1',
    parentToolCallId: 'tool-1',
    taskId: 'task-1',
    task: 'Review the permission change',
    title: '审查权限改动',
    role: 'reviewer',
    model: { protocol: 'anthropic-compatible', providerId: 'anthropic', modelId: 'claude-opus' },
    childSessionId: 'child-1',
    status: 'running',
    activity: { kind: 'tool', toolName: 'read', title: 'read (permission-policy.ts)' },
    revision: 1,
    createdAt: '2026-10-11T08:00:00.000Z',
    updatedAt: '2026-10-11T08:00:11.000Z',
    ...patch,
  };
}

const child: SessionSummary = {
  id: 'child-1',
  scope: { kind: 'project', projectPath: '/repo' },
  workingDirectory: '/repo',
  projectPath: '/repo',
  name: '审查权限改动',
  updatedAt: '2026-10-11T08:00:11.000Z',
  messageCount: 2,
  parentSessionId: 'parent-1',
  kind: 'subagent',
  subagentStatus: 'running',
  task: 'Review the permission change',
};

function row(patch: Partial<SubagentRowView>): SubagentRowView {
  return {
    ...deriveSubagentRowView({ tool, invocation: invocation(), locale: 'zh-CN' }),
    ...patch,
  };
}

describe('deriveSubagentRowView', () => {
  it('shows a running row on two lines with the Host activity', () => {
    const view = deriveSubagentRowView({ tool, invocation: invocation(), child, locale: 'zh-CN', canInspect: true });
    expect(view).toMatchObject({
      phase: 'running',
      status: 'running',
      seal: '校',
      title: '审查权限改动',
      role: 'reviewer',
      modelLabel: expect.any(String),
      stateLabel: '运行中',
      activity: '正在执行 read (permission-policy.ts)',
      showActivity: true,
      canInspect: true,
      startedAt: '2026-10-11T08:00:00.000Z',
    });
  });

  it('prefers the live stream over the persisted activity, but not over a permission wait', () => {
    const stream: SubagentStreamState = {
      childSessionId: 'child-1',
      completedSegments: [],
      completionRevision: 0,
      text: '',
      thinking: '',
      tools: [{ toolCallId: 't', toolName: 'grep', status: 'running', output: '' }],
      streaming: true,
      currentMessageId: 'm',
    };
    expect(
      deriveSubagentRowView({ tool, invocation: invocation(), child, stream, locale: 'zh-CN' }).activity,
    ).toBe('正在执行 grep');
    expect(
      deriveSubagentRowView({
        tool,
        invocation: invocation({ activity: { kind: 'permission', action: 'web_fetch' } }),
        child,
        stream,
        locale: 'zh-CN',
      }).activity,
    ).toBe('等待权限确认：web_fetch');
  });

  it('keeps a second line in every phase: conclusion when finished, error when failed', () => {
    const done = deriveSubagentRowView({
      tool,
      invocation: invocation({
        status: 'completed',
        activity: { kind: 'completed', summary: 'done\n- 符合 ADR 0019\n- 无回归' },
      }),
      locale: 'zh-CN',
    });
    expect(done).toMatchObject({ phase: 'done', stateLabel: '已完成', showActivity: true, activity: '符合 ADR 0019' });
    const failed = deriveSubagentRowView({
      tool,
      invocation: invocation({ status: 'failed', activity: { kind: 'failed', message: 'web_fetch 超时（30s）' } }),
      locale: 'zh-CN',
    });
    expect(failed).toMatchObject({ phase: 'failed', stateLabel: '失败', showActivity: true, activity: 'web_fetch 超时（30s）' });
  });

  it('queues an accepted start until the Host invocation arrives', () => {
    const start: ToolCardUi = {
      ...tool,
      status: 'done',
      presentation: {
        kind: 'subagent',
        title: 'Subagent',
        subagentControl: { phase: 'accepted', runId: 'run-1', invocationId: 'inv-9', task: '调研缓存策略' },
      },
    };
    expect(deriveSubagentRowView({ tool: start, locale: 'zh-CN' })).toMatchObject({
      phase: 'queued',
      stateLabel: '排队中',
      title: '调研缓存策略',
      invocationId: 'inv-9',
      anchorId: 'inv-9',
      showActivity: true,
    });
  });

  it('puts 代码待处理 / 冲突 badges on finished rows only, and none for a merged report', () => {
    const settled = invocation({ status: 'completed', activity: { kind: 'completed' } });
    const pending = deriveSubagentRowView({
      tool,
      invocation: settled,
      child: { ...child, subagentSummaryStatus: 'merged', subagentIntegrationStatus: 'pending' },
      locale: 'zh-CN',
    });
    expect(pending.status).toBe('needs-integration');
    expect(pending.badges).toEqual([{ tone: 'warning', label: '代码待处理', testId: 'subagent-badge-code-pending' }]);
    const conflict = deriveSubagentRowView({
      tool,
      invocation: settled,
      child: { ...child, subagentIntegrationStatus: 'conflict' },
      locale: 'zh-CN',
    });
    expect(conflict.badges.map((badge) => [badge.label, badge.tone])).toEqual([['冲突', 'danger']]);
    const running = deriveSubagentRowView({
      tool,
      invocation: invocation(),
      child: { ...child, subagentIntegrationStatus: 'pending' },
      locale: 'zh-CN',
    });
    expect(running.badges).toEqual([]);
  });

  it('hides tool and token counters when the Host did not send them (older Hosts)', () => {
    const view = deriveSubagentRowView({ tool, invocation: invocation(), child, locale: 'zh-CN' });
    expect(view.toolCalls).toBeUndefined();
    expect(view.totalTokens).toBeUndefined();
    expect(view.toolsLabel).toBeUndefined();
    expect(view.tokensLabel).toBeUndefined();
    // A missing model is hidden, never a placeholder.
    const { model: _model, ...withoutModel } = invocation();
    const noModel = deriveSubagentRowView({ tool, invocation: withoutModel, locale: 'zh-CN' });
    expect(noModel.modelLabel).toBeUndefined();
  });

  it('shows Host-counted tools and tokens as in the prototype meta line', () => {
    const view = deriveSubagentRowView({
      tool,
      invocation: invocation({ usage: { toolCalls: 7, totalTokens: 12_400, requests: 4 } }),
      locale: 'zh-CN',
    });
    expect(view).toMatchObject({
      toolCalls: 7,
      totalTokens: 12_400,
      toolsLabel: '7 工具',
      tokensLabel: '12k tok',
    });
    // Proto hides `0 tok` before the first request finalizes, but keeps the tool count.
    const fresh = deriveSubagentRowView({
      tool,
      invocation: invocation({ usage: { toolCalls: 0, totalTokens: 0, requests: 0 } }),
      locale: 'en',
    });
    expect(fresh.toolsLabel).toBe('0 tools');
    expect(fresh.tokensLabel).toBeUndefined();
  });

  it('maps a legacy transcript card onto a lone row', () => {
    const view = deriveLegacySubagentRowView({
      activity: {
        childSessionId: 'child-9',
        displayName: 'wiki 双语化',
        taskSummary: '中英对照改写',
        state: 'merged',
        updatedAt: '2026-10-11T08:00:00.000Z',
      },
      locale: 'zh-CN',
      canInspect: true,
      expanded: false,
    });
    expect(view).toMatchObject({ phase: 'done', seal: '双', anchorId: 'card:child-9', showActivity: true });
  });
});

describe('areSubagentRowViewsEqual', () => {
  it('treats a fresh snapshot with the same values as unchanged', () => {
    const a = deriveSubagentRowView({ tool, invocation: invocation(), child, locale: 'zh-CN' });
    const b = deriveSubagentRowView({ tool: { ...tool }, invocation: invocation(), child: { ...child }, locale: 'zh-CN' });
    expect(a).not.toBe(b);
    expect(areSubagentRowViewsEqual(a, b)).toBe(true);
  });

  it('notices any changed field, including badges and optional fields', () => {
    const base = row({});
    expect(areSubagentRowViewsEqual(base, row({ activity: 'other' }))).toBe(false);
    expect(areSubagentRowViewsEqual(base, row({ expanded: true }))).toBe(false);
    expect(
      areSubagentRowViewsEqual(base, row({ badges: [{ tone: 'danger', label: '冲突', testId: 'x' }] })),
    ).toBe(false);
    expect(areSubagentRowViewsEqual(base, row({ toolCalls: 3, toolsLabel: '3 工具' }))).toBe(false);
    expect(areSubagentRowViewsEqual(row({ totalTokens: 10 }), row({ totalTokens: 10 }))).toBe(true);
    const { modelLabel: _drop, ...withoutModel } = base;
    expect(areSubagentRowViewsEqual(base, withoutModel as SubagentRowView)).toBe(false);
  });
});

describe('group summary', () => {
  it('counts phases and only reports an end time once every row settled', () => {
    const rows = [
      row({ phase: 'done', startedAt: '2026-10-11T08:00:00.000Z', endedAt: '2026-10-11T08:00:14.000Z' }),
      row({ phase: 'failed', startedAt: '2026-10-11T08:00:03.000Z', endedAt: '2026-10-11T08:00:30.000Z' }),
      row({ phase: 'running', startedAt: '2026-10-11T08:00:00.000Z', endedAt: '2026-10-11T08:00:20.000Z' }),
    ];
    const live = deriveSubagentGroupSummary(rows, 'zh-CN');
    expect(live).toMatchObject({ count: 3, countsLabel: '1 完成 · 1 失败 · 1 运行中', active: true, startedAt: '2026-10-11T08:00:00.000Z' });
    expect(live.endedAt).toBeUndefined();
    const settled = deriveSubagentGroupSummary(
      rows.map((item) => (item.phase === 'running' ? { ...item, phase: 'done' as const } : item)),
      'zh-CN',
    );
    expect(settled).toMatchObject({ countsLabel: '2 完成 · 1 失败', active: false, endedAt: '2026-10-11T08:00:30.000Z' });
  });

  it('totals tools and tokens in the settled header only when every row has Host counters', () => {
    const counted = [
      row({ phase: 'done', toolCalls: 4, totalTokens: 8_000 }),
      row({ phase: 'failed', toolCalls: 5, totalTokens: 10_500 }),
    ];
    expect(deriveSubagentGroupSummary(counted, 'zh-CN').usageLabel).toBe('9 工具 · 19k tok');
    // While anything runs the header shows only the elapsed time (proto ①).
    expect(
      deriveSubagentGroupSummary([...counted, row({ phase: 'running', toolCalls: 1, totalTokens: 0 })], 'zh-CN')
        .usageLabel,
    ).toBeUndefined();
    // A row from an older Host would make the sum an undercount: hide it.
    expect(deriveSubagentGroupSummary([...counted, row({ phase: 'done' })], 'zh-CN').usageLabel).toBeUndefined();
  });

  it('flags attention when a finished row carries a badge', () => {
    const summary = deriveSubagentGroupSummary(
      [row({ phase: 'done', badges: [{ tone: 'warning', label: '代码待处理', testId: 'b' }] })],
      'zh-CN',
    );
    expect(summary.attention).toBe(true);
  });

  it('keeps a live or attention group open, folds a settled one, and lets a click win', () => {
    const settled = { active: false, attention: false };
    expect(resolveSubagentGroupExpanded({ userChoice: null, summary: { active: true, attention: false }, hasOpenRow: false })).toBe(true);
    expect(resolveSubagentGroupExpanded({ userChoice: null, summary: settled, hasOpenRow: false })).toBe(false);
    expect(resolveSubagentGroupExpanded({ userChoice: null, summary: { active: false, attention: true }, hasOpenRow: false })).toBe(true);
    expect(resolveSubagentGroupExpanded({ userChoice: null, summary: settled, hasOpenRow: true })).toBe(true);
    expect(resolveSubagentGroupExpanded({ userChoice: true, summary: settled, hasOpenRow: false })).toBe(true);
    expect(resolveSubagentGroupExpanded({ userChoice: false, summary: { active: true, attention: true }, hasOpenRow: false })).toBe(false);
  });
});

describe('segmentSubagentRuns', () => {
  it('groups only consecutive delegations, keeping order', () => {
    const items = ['a', 'S1', 'S2', 'b', 'S3'];
    expect(segmentSubagentRuns(items, (item) => item.startsWith('S'))).toEqual([
      { kind: 'item', item: 'a' },
      { kind: 'subagents', items: ['S1', 'S2'] },
      { kind: 'item', item: 'b' },
      { kind: 'subagents', items: ['S3'] },
    ]);
  });
});

describe('formatSubagentElapsed', () => {
  it('matches the prototype format', () => {
    expect(formatSubagentElapsed(0, 14_900)).toBe('14s');
    expect(formatSubagentElapsed(0, 187_000)).toBe('3m 7s');
    expect(formatSubagentElapsed(10, 0)).toBe('');
    expect(formatSubagentElapsed(Number.NaN, 0)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import {
  renderSubagentFanout,
  subagentFanoutBranch,
  subagentFanoutOriginRow,
  type SubagentFanoutRow,
} from './subagent-fanout-view.js';
import type { LiveSubagentRun } from './subagent-run-view.js';

const T0 = Date.parse('2026-10-14T10:00:00Z');
const plain = (lines: string[]): string[] => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd());

function run(overrides: Partial<LiveSubagentRun>): LiveSubagentRun {
  return {
    invocationId: 'i',
    runId: 'b',
    task: 'task',
    status: 'running',
    activity: '思考中',
    startedAt: T0,
    ...overrides,
  };
}

const ROWS: SubagentFanoutRow[] = [
  {
    key: 'a',
    task: '实现导出接口',
    live: run({
      title: '实现导出接口',
      status: 'completed',
      activity: '已完成',
      summary: 'complete\n- 导出路径改走 media 目录\n- 补了越界用例',
      totalTokens: 9400,
      endedAt: T0 + 10_000,
    }),
  },
  {
    key: 'b',
    task: '审查权限改动',
    live: run({
      title: '审查权限改动',
      step: 'read packages/host-runtime/src/permission-policy.ts',
      recentSteps: ['✓ grep allow(', '… read packages/host-runtime/src/permission-policy.ts'],
      totalTokens: 6900,
    }),
  },
  {
    key: 'c',
    task: '调研缓存策略',
    live: run({ title: '调研缓存策略', status: 'failed', activity: '失败：web_fetch 超时', totalTokens: 2900, endedAt: T0 + 27_000 }),
  },
];

describe('subagent fan-out branches', () => {
  it('puts the origin on the middle row, the upper middle for an even count', () => {
    expect([1, 2, 3, 4, 5].map(subagentFanoutOriginRow)).toEqual([0, 0, 1, 1, 2]);
  });

  it('draws one connector per row, crossing at the origin', () => {
    const branches = (count: number): string[] =>
      Array.from({ length: count }, (_, index) => subagentFanoutBranch(index, count));
    expect(branches(2)).toEqual(['┬─', '└─']);
    expect(branches(3)).toEqual(['┌─', '┼─', '└─']);
    expect(branches(4)).toEqual(['┌─', '┼─', '├─', '└─']);
  });
});

describe('renderSubagentFanout', () => {
  it('draws the header, the main-agent label on the origin row, and one line per child', () => {
    const lines = plain(renderSubagentFanout(ROWS, 100, false, T0 + 63_000));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^ ◌ 派出 3 个子代理 {2}1 完成 · 1 运行中 · 1 失败 +19k tok · 1m 03s$/);
    expect(lines[1]).toMatch(/^ {12}┌─ ✓ 实现导出接口 +导出路径改走 media 目录 +9\.4k tok · 10s$/);
    expect(lines[2]).toMatch(/^ {3}主代理 ──┼─ ◌ 审查权限改动 +read packages\/host-runtime\/src\/permission-po… 6\.9k tok · 1m 03s$/);
    expect(lines[3]).toMatch(/^ {12}└─ ✗ 调研缓存策略 +失败：web_fetch 超时 +2\.9k tok · 27s$/);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(100);
  });

  it('drops the main-agent column and tokens on a narrow terminal', () => {
    const lines = plain(renderSubagentFanout(ROWS, 60, false, T0 + 63_000));
    expect(lines[1]).toMatch(/^ {3}├ ✓ 实现导出接口/);
    expect(lines[3]).toMatch(/^ {3}└ ✗ 调研缓存策略/);
    expect(lines.join('\n')).not.toContain('主代理');
    expect(lines.slice(1).join('\n')).not.toContain('tok');
  });

  it('expands to the report under finished rows and recent steps under running ones', () => {
    const lines = plain(renderSubagentFanout(ROWS, 100, true, T0 + 63_000));
    const text = lines.join('\n');
    expect(text).toContain('│    导出路径改走 media 目录');
    expect(text).toContain('│    - 补了越界用例');
    expect(text).not.toContain('complete');
    expect(text).toContain('│    ✓ grep allow(');
  });

  it('marks a result that waits for a decision and counts it', () => {
    const lines = plain(
      renderSubagentFanout(
        [ROWS[0] as SubagentFanoutRow, { key: 'p', task: 'x', live: run({ title: '待处理的', status: 'needs-integration', endedAt: T0 }) }],
        100,
        false,
        T0,
      ),
    );
    expect(lines[0]).toContain('2 完成 · 1 待处理');
    expect(lines[2]).toContain('结果待处理 · /subagents');
  });

  it('shows a delegation the Host has not reported yet as dispatched', () => {
    const lines = plain(renderSubagentFanout([{ key: 'x', task: '还没回报的任务', live: undefined }, ROWS[1] as SubagentFanoutRow], 100, false, T0));
    expect(lines[1]).toContain('· 还没回报的任务');
    expect(lines[1]).toContain('已派出');
  });
});

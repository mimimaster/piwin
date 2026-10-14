import type { SubagentPreviewView } from '@piwin/host-client';
import { describe, expect, it } from 'vitest';
import { paintSubagentPreview } from './subagent-preview-view.js';

const plain = (lines: string[]): string[] => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd());

const VIEW: SubagentPreviewView = {
  meta: ['reviewer', 'opus', '7 次工具调用', '13.8k tok'],
  statusLabel: '已完成',
  live: false,
  task: '审查 permission-policy 的改动是否符合 ADR 0019，只读不改',
  lines: [
    { kind: 'tool', key: 't1', offset: '0:01', verb: 'read', target: 'src/a.ts', result: '212 行', status: 'done' },
    { kind: 'tool', key: 't2', offset: '0:06', verb: 'bash', target: 'rg -n export', result: 'exit 2', status: 'error' },
    { kind: 'say', key: 'm1:say', offset: '', text: '找到两条直连路径' },
    { kind: 'tool', key: 't3', offset: '0:12', verb: 'grep', target: 'allow(', result: '', status: 'running' },
  ],
  elidedCount: 23,
  outcome: { tone: 'done', label: '结论', text: '符合 ADR 0019。\n- file-write gate 仍生效' },
  startedAt: '2026-10-14T10:00:00Z',
  endedAt: '2026-10-14T10:01:03Z',
};

describe('paintSubagentPreview', () => {
  it('heads with identity, counters, elapsed and status, then the task', () => {
    const { header } = paintSubagentPreview(VIEW, '审查权限改动', 80);
    expect(plain(header)).toEqual([
      '审查权限改动 · reviewer · opus · 7 次工具调用 · 13.8k tok · 1m 03s 已完成',
      '任务 审查 permission-policy 的改动是否符合 ADR 0019，只读不改',
    ]);
  });

  it('aligns one line per step with its result, then the plain report', () => {
    const { body } = paintSubagentPreview(VIEW, 'x', 60);
    const lines = plain(body);
    expect(lines[0]).toBe('     … 前 23 步已省略');
    expect(lines[1]).toMatch(/^0:01 read src\/a\.ts +✓ 212 行$/);
    expect(lines[2]).toMatch(/^0:06 bash rg -n export +✗ exit 2$/);
    expect(lines[3]).toBe('     说   找到两条直连路径');
    expect(lines[4]).toMatch(/^0:12 grep allow\( +…$/);
    expect(lines.slice(5)).toEqual(['', '结论', '符合 ADR 0019。', '- file-write gate 仍生效']);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
  });

  it('says so when a running child has no steps yet', () => {
    const { outcome: _outcome, ...running } = VIEW;
    const { body } = paintSubagentPreview({ ...running, live: true, lines: [], elidedCount: 0 }, 'x', 60);
    expect(plain(body)).toEqual(['     还没有步骤']);
  });
});

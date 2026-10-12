import type { SubagentInvocation } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { renderSubagentControl, toLiveRun, type LiveSubagentRun } from './subagent-run-view.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (lines: string[]): string[] => lines.map((line) => line.replace(ANSI, ''));
const T0 = Date.parse('2026-10-12T07:00:00Z');

function invocation(id: string, patch: Partial<SubagentInvocation>): SubagentInvocation {
  return {
    id,
    parentSessionId: 'p',
    runId: 'batch',
    taskId: id,
    task: 'task',
    status: 'running',
    activity: { kind: 'thinking' },
    revision: 1,
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    ...patch,
  } as SubagentInvocation;
}

describe('renderSubagentControl', () => {
  const live = new Map<string, LiveSubagentRun>([
    ['i1', toLiveRun(invocation('i1', { status: 'completed', activity: { kind: 'completed' }, updatedAt: new Date(T0 + 41_000).toISOString() }))],
    ['i2', toLiveRun(invocation('i2', { activity: { kind: 'tool', toolName: 'edit', title: 'edit a.ts' } }))],
  ]);
  const lookup = (invocationId: string | undefined): LiveSubagentRun | undefined =>
    invocationId === undefined ? undefined : live.get(invocationId);
  const control = {
    phase: 'waiting' as const,
    total: 3,
    completed: 1,
    failed: 0,
    cancelled: 0,
    needsIntegration: 1,
    runs: [
      { runId: 'r1', invocationId: 'i1', title: '调研 ACP', executionStatus: 'completed' as const, summaryPreview: 'ACP 用 JSON-RPC' },
      { runId: 'r2', invocationId: 'i2', title: '重构 view', executionStatus: 'running' as const },
      { runId: 'r3', title: '写测试', executionStatus: 'completed' as const, integrationStatus: 'pending' as const },
    ],
  };

  it('draws a header with counts and one line per run', () => {
    const lines = plain(renderSubagentControl(control, 100, false, lookup, T0 + 72_000));
    expect(lines[0]).toBe('   子代理 ×3 (1 完成 · 2 运行中 · 1 待处理) · 1m 12s');
    expect(lines[1]).toBe('   ├ ✓ 调研 ACP  已完成 · 41s');
    expect(lines[2]).toBe('   ├ ◌ 重构 view  执行工具 edit a.ts · 1m 12s');
    expect(lines[3]).toBe('   └ ⚠ 写测试  结果待处理 · /subagents');
    expect(lines.at(-1)).toBe('   Ctrl+O 展开摘要');
  });

  it('shows summaries only when expanded', () => {
    const folded = plain(renderSubagentControl(control, 100, false, lookup, T0)).join('\n');
    expect(folded).not.toContain('ACP 用 JSON-RPC');
    const expanded = plain(renderSubagentControl(control, 100, true, lookup, T0)).join('\n');
    expect(expanded).toContain('│   ACP 用 JSON-RPC');
  });

  it('draws a single delegated task with its live activity', () => {
    const lines = plain(
      renderSubagentControl({ phase: 'accepted', runId: 'batch', invocationId: 'i2', task: '重构\n view' }, 100, false, lookup, T0 + 5_000),
    );
    expect(lines).toEqual(['   └ ◌ 重构 view 执行工具 edit a.ts · 5s']);
  });
});

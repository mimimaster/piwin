import type { AssistantUsageMeasurement, ContextOccupancy } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { buildContextReport, formatTokens } from './context-report.js';

const known = (patch: Partial<Extract<ContextOccupancy, { kind: 'known' }>> = {}): ContextOccupancy => ({
  kind: 'known',
  tokensUsed: 50_000,
  tokensLimit: 200_000,
  quality: 'measured',
  coverage: 'complete',
  basis: 'provider-usage',
  sampledAt: '2026-10-09T00:00:00Z',
  ...patch,
});

const request = (patch: Partial<AssistantUsageMeasurement> = {}): AssistantUsageMeasurement => ({
  measurementId: 'm1',
  sessionId: 's1',
  messageId: 'a1',
  promptTokens: 2_000,
  completionTokens: 800,
  totalTokens: 10_800,
  recordedAt: '2026-10-09T00:00:00Z',
  ...patch,
});

const text = (lines: string[]): string => lines.join('\n');

describe('buildContextReport', () => {
  it('draws the occupancy as a bar with the numbers beside it', () => {
    const report = text(buildContextReport({ occupancy: known(), lastRequest: null, model: 'Grok 4.5' }));
    expect(report).toContain('25%');
    expect(report).toContain('50.0k / 200.0k tokens · 实测');
    expect(report).toContain('█'.repeat(6) + '░'.repeat(18));
    expect(report).not.toContain('/compact');
  });

  it('suggests compaction once the window is nearly full', () => {
    const report = text(buildContextReport({ occupancy: known({ tokensUsed: 170_000 }), lastRequest: null, model: 'm' }));
    expect(report).toContain('85%');
    expect(report).toContain('/compact');
  });

  it('says so when the numbers are estimated or cover only part of the history', () => {
    const report = text(
      buildContextReport({ occupancy: known({ quality: 'estimated', coverage: 'partial' }), lastRequest: null, model: 'm' }),
    );
    expect(report).toContain('估算 · 仅含部分消息');
  });

  it('does not invent a percentage without a window size', () => {
    const report = text(buildContextReport({ occupancy: ({ kind: 'known', tokensUsed: 5_000, quality: 'measured', coverage: 'complete', basis: 'b', sampledAt: 'x' }), lastRequest: null, model: 'm' }));
    expect(report).toContain('窗口大小未知');
    expect(report).not.toContain('%');
  });

  it('reports a session that was never sampled as having no data yet', () => {
    const report = text(buildContextReport({ occupancy: { kind: 'unknown', reason: 'never-sampled' }, lastRequest: null, model: 'm' }));
    expect(report).toContain('暂无数据（还没有发过请求）');
    expect(report).toContain('最近一次请求  还没有');
  });

  it('shows the last request with cache hit rate and timing', () => {
    const report = text(
      buildContextReport({
        occupancy: known(),
        lastRequest: request({ cacheReadTokens: 6_000, cacheWriteTokens: 2_000, reasoningTokens: 300, durationMs: 8_200, firstTokenMs: 1_100 }),
        model: 'Grok 4.5',
        thinking: 'high',
      }),
    );
    expect(report).toContain('Grok 4.5 · 思考 high');
    expect(report).toContain('输入 2.0k · 输出 800（其中推理 300） · 合计 10.8k');
    expect(report).toContain('缓存命中 60%（读 6.0k · 写 2.0k）');
    expect(report).toContain('耗时 8.2s · 首字 1.1s');
  });
});

describe('formatTokens', () => {
  it('abbreviates by magnitude', () => {
    expect([formatTokens(999), formatTokens(1_500), formatTokens(2_500_000)]).toEqual(['999', '1.5k', '2.50M']);
  });
});

import { describe, expect, it } from 'vitest';
import { buildStatusMetricValues } from './status-values.js';
import { createStyle } from './tui-style.js';

const plain = createStyle({ NO_COLOR: '1' });
const colour = createStyle({});
const metrics = {
  ttftMs: 820, ttftTone: 'ok' as const, tokensPerSecond: 86.4, lastDurationMs: 18_400,
  inputTokens: 1_240_000, outputTokens: 38_000, cacheHitRate: 0.71, costUsd: 0.42,
  context: { used: 92_000, limit: 200_000, ratio: 0.46, estimated: false, tone: 'ok' as const },
};
const strip = (text: string | undefined) => (text ?? '').replace(/\x1b\[[0-9;]*m/g, '');

describe('buildStatusMetricValues', () => {
  it('renders the idle fields with concise labels', () => {
    const values = buildStatusMetricValues({ metrics, style: plain });
    expect(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, strip(value)]))).toEqual({
      elapsed: '上轮 18.4s',
      ttft: '首字 0.82s',
      tps: '86 tok/s',
      context: 'ctx 46%',
      ctx: 'ctx 46% 92k/200k',
      ctxbar: 'ctx ▰▰▰▱▱▱ 46% 92k/200k',
      tokens: '↑1.2M ↓38k',
      cache: '缓存 71%',
    });
  });

  it('shows cost only when enabled', () => {
    expect(buildStatusMetricValues({ metrics, style: plain, showCost: true }).cost).toBe('$0.42');
  });

  it('shows the running turn instead of the last one', () => {
    expect(strip(buildStatusMetricValues({ metrics, style: plain, running: { phase: 'streaming', elapsedMs: 12_000 } }).elapsed)).toBe('● 生成中 12s');
  });

  it('marks estimates, compaction and colours thresholds', () => {
    const warn = buildStatusMetricValues({ metrics: { ...metrics, context: { ...metrics.context, ratio: 0.75, estimated: true, tone: 'warn' } }, style: colour });
    expect(strip(warn.context)).toBe('ctx ~75%');
    expect(warn.context).toContain('\x1b[33m~75%');
    const critical = buildStatusMetricValues({ metrics: { ...metrics, ttftMs: 6000, ttftTone: 'critical' }, style: colour });
    expect(critical.ttft).toContain('\x1b[31m');
    expect(strip(buildStatusMetricValues({ metrics, style: plain, compacting: true }).ctxbar)).toBe('⟳ 压缩中');
  });
});

import { describe, expect, it } from 'vitest';
import { desktopMetrics } from '../run-activity/diagnostic-metrics.js';
import {
  describeVisualDegradationPolicy,
  type MemoryDiagnosticsPanelData,
} from './memory-diagnostics-format.js';
import { createMemoryDiagnosticsReport } from './memory-diagnostics-report.js';

const NOW = 1_700_000_000_000;
const GIB = 1024 ** 3;
function data(): MemoryDiagnosticsPanelData {
  return { native: { samples: [{ bytes: 4.48 * GIB, aggregateFootprintBytes: 4.52 * GIB,
    timestampMs: NOW }], purgeResults: [], stalledTicks: 0 },
  frontend: desktopMetrics.collectObservability(), level: 'critical', episode: undefined,
  presentations: 1, visible: 1, restoring: 0, warmSnapshots: 0, eligibleCandidates: 0 };
}

describe('readable memory report', () => {
  it('explains the owner’s protected-only high-usage state in concise bilingual copy', () => {
    const report = createMemoryDiagnosticsReport(data(), 'zh-CN', NOW);
    expect(report.status).toBe('占用过高');
    expect(report.sampling).toBe('实时 · fresh');
    expect(report.governorLevel).toBe('critical');
    expect(report.explanation).toContain('已没有闲置资源可清理');
    expect(report.explanation).toContain('可见与恢复中');
    expect(report.mainBytes).toBeCloseTo(4.48 * GIB);
    expect(report.aggregateBytes).toBeCloseTo(4.52 * GIB);
  });
  it('keeps the last reading but does not call stale data healthy', () => {
    const input = data();
    input.level = 'normal';
    const report = createMemoryDiagnosticsReport(input, 'zh-CN', NOW + 180_000);
    expect(report.condition).toBe('stale');
    expect(report.tone).toBe('warning');
    expect(report.sampling).toBe('已过期 · stale');
    expect(report.explanation).toContain('上次采样');
    expect(report.mainBytes).toBeDefined();
  });
  it('does not invent zero-byte or normal usage when sampling is missing', () => {
    const input = data();
    input.native = null;
    input.level = 'normal';
    const report = createMemoryDiagnosticsReport(input, 'zh-CN', NOW);
    expect(report.condition).toBe('unavailable');
    expect(report.mainBytes).toBeUndefined();
    expect(report.explanation).toContain('不代表界面没有占用内存');
  });
  it('offers idle cleanup only when eligible resources exist', () => {
    const input = data();
    input.eligibleCandidates = 2;
    const report = createMemoryDiagnosticsReport(input, 'zh-CN', NOW);
    expect(report.explanation).toContain('可以清理闲置资源');
    expect(report.explanation).not.toContain('已没有');
  });

  it('downgrades core status animations to low-memory motion under critical pressure and pauses only when parked', () => {
    const base = data();
    base.frontend.resourceCounts = { liveStatusAnimations: 1 };

    const criticalPolicy = describeVisualDegradationPolicy({ ...base, level: 'critical', parked: false }, 'en');
    expect(criticalPolicy.find((row) => row.id === 'core-motion')).toMatchObject({
      active: true,
      status: 'Low-memory motion (1 mounted)',
    });
    expect(criticalPolicy.find((row) => row.id === 'text-shimmer')?.active).toBe(false);
    expect(criticalPolicy.find((row) => row.id === 'glass-and-masks')?.active).toBe(false);

    const parkedPolicy = describeVisualDegradationPolicy({ ...base, level: 'normal', parked: true }, 'zh-CN');
    expect(parkedPolicy.find((row) => row.id === 'core-motion')).toMatchObject({
      active: false,
      status: '已暂停 · 窗口隐藏（1 个）',
    });
  });
});

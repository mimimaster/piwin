import { describe, expect, it } from 'vitest';
import {
  buildLastRequestDetailRows,
  buildOccupancyDetailRows,
  contextUsageCopyHasMixedEnglish,
  formatContextOccupancyCopy,
  formatUsageDurationMs,
  formatUsageTokenCount,
  getContextUsageCopy,
} from './conversation-usage-copy.js';
import { makeLastRequest } from './context-telemetry-test-fixtures.js';

describe('conversation usage copy', () => {
  it('formats occupancy as used / limit', () => {
    expect(formatContextOccupancyCopy(12_400, 128_000)).toBe('12K / 128K');
    expect(formatUsageTokenCount(850)).toBe('850');
    expect(formatUsageDurationMs(850)).toBe('850ms');
    expect(formatUsageDurationMs(1_200)).toBe('1.2s');
  });

  it('omits last-request fields until Host reports them', () => {
    const rows = buildOccupancyDetailRows({
      used: 12_400,
      limit: 128_000,
    });
    expect(rows.map((row) => row.id)).toEqual(['occupied', 'limit']);
    expect(buildLastRequestDetailRows({ usage: null })).toEqual([]);
  });

  it('T26: last-request rows only include real fields, never category percentages', () => {
    const rows = buildLastRequestDetailRows({
      usage: makeLastRequest({
        promptTokens: 700,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        completionTokens: 200,
        totalTokens: 1_050,
        durationMs: 1_200,
      }),
      locale: 'en',
    });
    expect(rows.map((row) => row.id)).toEqual([
      'input',
      'cache-read',
      'cache-write',
      'output',
      'total',
      'duration',
    ]);
    expect(rows.some((row) => row.value.includes('~'))).toBe(false);
    expect(rows.some((row) => row.label.toLowerCase().includes('system'))).toBe(false);
  });

  it('T29: zh-CN strings cover ring copy without leftover English', () => {
    const zh = getContextUsageCopy('zh-CN');
    const en = getContextUsageCopy('en');
    expect(zh.title).toBe('上下文占用');
    expect(zh.close).toBe('关闭');
    expect(zh.settings).toContain('上下文');
    expect(zh.estimated).toBe('估算');
    expect(zh.confirmed).toBe('已确认');
    expect(zh.pendingMeasurement).toBe('当前上下文待测量');
    expect(zh.realtimeEstimate).toBe('实时估算');
    expect(zh.limitUnknown).toBe('上限未知');
    expect(zh.exceedsLimit).toBe('超过上下文上限');
    expect(zh.compactedPending).toContain('已压缩');
    expect(zh.capabilityMissing).toContain('不支持');
    expect(zh.offline).toContain('离线');
    expect(en.title).toBe('Context usage');
    expect(en.capabilityMissing).toMatch(/does not support/i);
    expect(contextUsageCopyHasMixedEnglish('zh-CN')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  formatSubagentToolCalls,
  formatSubagentTokens,
  subagentUsageLabels,
  sumSubagentUsageLabel,
} from './subagent-usage-view';

describe('subagent usage view', () => {
  it('formats tokens like the prototype', () => {
    expect(formatSubagentTokens(830)).toBe('830 tok');
    expect(formatSubagentTokens(4_210)).toBe('4.2k tok');
    expect(formatSubagentTokens(38_400)).toBe('38k tok');
    expect(formatSubagentTokens(Number.NaN)).toBe('');
  });

  it('labels tool counts per locale', () => {
    expect(formatSubagentToolCalls(3, 'zh-CN')).toBe('3 次工具调用');
    expect(formatSubagentToolCalls(1, 'en')).toBe('1 tool call');
  });

  it('returns nothing for a Host that sent no counters', () => {
    expect(subagentUsageLabels(undefined, 'zh-CN')).toBeUndefined();
    expect(sumSubagentUsageLabel([], 'zh-CN')).toBeUndefined();
    expect(sumSubagentUsageLabel([{ toolCalls: 1, totalTokens: 5 }, {}], 'zh-CN')).toBeUndefined();
  });

  it('sums every row', () => {
    expect(
      sumSubagentUsageLabel(
        [
          { toolCalls: 2, totalTokens: 600 },
          { toolCalls: 1, totalTokens: 700 },
        ],
        'en',
      ),
    ).toBe('3 tools · 1.3k tok');
    expect(sumSubagentUsageLabel([{ toolCalls: 2, totalTokens: 0 }], 'zh-CN')).toBe('2 工具');
  });
});

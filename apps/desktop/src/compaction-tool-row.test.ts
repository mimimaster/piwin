import { describe, expect, it } from 'vitest';
import type { CompactionActivityUi } from './chat-reducer.js';
import {
  COMPACTION_TOOL_NAME,
  mapCompactionActivityToToolRow,
} from './compaction-tool-row.js';

function baseActivity(overrides: Partial<CompactionActivityUi> = {}): CompactionActivityUi {
  return {
    operationId: 'compact-1',
    phase: 'succeeded',
    reason: 'manual',
    anchorMessageId: 'assistant-1',
    startedAt: 1_000,
    ...overrides,
  };
}

describe('mapCompactionActivityToToolRow', () => {
  it('uses the operation id as the tool-call id so a phase change updates one row', () => {
    const running = mapCompactionActivityToToolRow(baseActivity({ phase: 'running' }), 'en');
    const settled = mapCompactionActivityToToolRow(baseActivity({ phase: 'succeeded' }), 'en');
    expect(running.toolCallId).toBe('compact-1');
    expect(settled.toolCallId).toBe('compact-1');
    expect(running.toolName).toBe(COMPACTION_TOOL_NAME);
  });

  it('maps phases onto tool status, keeping cancellation a settled outcome', () => {
    expect(mapCompactionActivityToToolRow(baseActivity({ phase: 'running' }), 'en').status).toBe(
      'running',
    );
    expect(mapCompactionActivityToToolRow(baseActivity({ phase: 'succeeded' }), 'en').status).toBe(
      'done',
    );
    expect(mapCompactionActivityToToolRow(baseActivity({ phase: 'cancelled' }), 'en').status).toBe(
      'done',
    );
    expect(mapCompactionActivityToToolRow(baseActivity({ phase: 'failed' }), 'en').status).toBe(
      'error',
    );
  });

  it('puts the token delta in the head and the model summary in the body', () => {
    const row = mapCompactionActivityToToolRow(
      baseActivity({ tokensBefore: 120_000, tokensAfter: 8_400, summary: 'kept decisions' }),
      'en',
    );
    expect(row.presentation?.summary).toBe('120K → 8.4K tokens');
    expect(row.presentation?.output?.text).toBe('kept decisions');
    expect(row.output).toBe('kept decisions');
  });

  it('omits the head summary while running so the row is verb-only', () => {
    const row = mapCompactionActivityToToolRow(baseActivity({ phase: 'running' }), 'en');
    expect(row.presentation?.summary).toBe('');
    expect(row.presentation?.actionVerb).toBe('Compacting context');
  });

  it('reports a failure through the structured tool error, not the head', () => {
    const row = mapCompactionActivityToToolRow(
      baseActivity({ phase: 'failed', message: 'provider refused the summary request' }),
      'en',
    );
    expect(row.presentation?.summary).toBe('');
    expect(row.presentation?.error).toEqual({
      category: 'execution',
      message: 'provider refused the summary request',
    });
  });

  it('derives duration from the phase boundary when the host omitted it', () => {
    const row = mapCompactionActivityToToolRow(
      baseActivity({ startedAt: 1_000, endedAt: 3_500 }),
      'en',
    );
    expect(row.presentation?.durationMs).toBe(2_500);
  });

  it('prefers the host-reported duration over the wall-clock boundary', () => {
    const row = mapCompactionActivityToToolRow(
      baseActivity({ startedAt: 1_000, endedAt: 3_500, durationMs: 1_200 }),
      'en',
    );
    expect(row.presentation?.durationMs).toBe(1_200);
  });

  it('localizes the action verb', () => {
    expect(
      mapCompactionActivityToToolRow(baseActivity({ phase: 'running' }), 'zh-CN').presentation
        ?.actionVerb,
    ).toBe('整理上下文');
    expect(
      mapCompactionActivityToToolRow(baseActivity({ phase: 'succeeded' }), 'zh-CN').presentation
        ?.actionVerb,
    ).toBe('已整理上下文');
  });

  it('bounds an oversized summary body', () => {
    const row = mapCompactionActivityToToolRow(
      baseActivity({ summary: 'x'.repeat(20_000) }),
      'en',
    );
    expect(row.output.length).toBe(8_000);
  });
});
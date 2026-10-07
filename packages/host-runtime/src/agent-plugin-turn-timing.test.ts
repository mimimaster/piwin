import { describe, expect, it } from 'vitest';
import { computeTokensPerSecond, type AgentEvent } from '@piwin/contracts';
import { AgentPluginTurnTiming } from './agent-plugin-turn-timing.js';

function usage(overrides: Record<string, unknown> = {}): Extract<AgentEvent, { type: 'usage/finalized' }> {
  return {
    type: 'usage/finalized',
    measurement: {
      measurementId: 's1:m1', sessionId: 's1', messageId: 'm1', runId: 'run-1',
      totalTokens: 240, completionTokens: 200, recordedAt: '2026-10-02T00:00:00Z',
      ...overrides,
    },
  };
}

describe('Agent plugin turn timing', () => {
  it('measures first content and elapsed turn on the same clock for usage TPS', () => {
    let clockMs = 100;
    const timing = new AgentPluginTurnTiming(() => clockMs);
    timing.begin('run-1');
    clockMs = 200;
    timing.observe({ type: 'message/start', messageId: 'm1', role: 'assistant' });
    timing.observe({ type: 'message/text_delta', messageId: 'm1', delta: '' });
    clockMs = 400;
    timing.observe({ type: 'message/thinking_delta', messageId: 'm1', delta: 'thinking' });
    clockMs = 600;
    timing.observe({ type: 'message/text_delta', messageId: 'm1', delta: 'answer' });
    clockMs = 2400;
    const event = timing.observe(usage({ durationMs: 50 }));
    if (event.type !== 'usage/finalized') throw new Error('usage expected');
    expect(event.measurement).toMatchObject({
      durationMs: 2300, firstTokenMs: 300, firstTokenKind: 'reasoning', timingScope: 'turn',
    });
    expect(computeTokensPerSecond({
      completionTokens: event.measurement.completionTokens ?? 0,
      ...(event.measurement.durationMs !== undefined ? { durationMs: event.measurement.durationMs } : {}),
      ...(event.measurement.firstTokenMs !== undefined ? { firstTokenMs: event.measurement.firstTokenMs } : {}),
      ...(event.measurement.firstTokenKind !== undefined ? { firstTokenKind: event.measurement.firstTokenKind } : {}),
    })).toBe(100);
  });

  it.each<AgentEvent>([
    { type: 'message/text_delta', messageId: 'm1', delta: ' ' },
    { type: 'message/text_snapshot', messageId: 'm1', text: 'snapshot' },
    { type: 'tool/start', toolCallId: 't1', toolName: 'read' },
  ])('counts observable model content: $type', (content) => {
    let clockMs = 0;
    const timing = new AgentPluginTurnTiming(() => clockMs);
    timing.begin('run-1');
    clockMs = 250;
    timing.observe(content);
    expect(timing.observe(usage())).toMatchObject({ measurement: { firstTokenMs: 250 } });
  });

  it('preserves adapter-supplied timing and does not mutate its measurement', () => {
    const timing = new AgentPluginTurnTiming(() => 400);
    timing.begin('run-1');
    const supplied = usage({ durationMs: 1200, firstTokenMs: 300, timingScope: 'request' });
    expect(timing.observe(supplied)).toBe(supplied);
  });

  it('does not invent first-token latency for a silent turn', () => {
    const timing = new AgentPluginTurnTiming(() => 0);
    timing.begin('run-1');
    const event = timing.observe(usage());
    expect(event).toMatchObject({ measurement: { durationMs: 0, timingScope: 'turn' } });
    if (event.type !== 'usage/finalized') throw new Error('usage expected');
    expect(event.measurement.firstTokenMs).toBeUndefined();
  });

  it('ignores replay and stale Runs and resets first-token timing for the next turn', () => {
    let clockMs = 0;
    const timing = new AgentPluginTurnTiming(() => clockMs);
    const replay = usage();
    expect(timing.observe(replay)).toBe(replay);
    timing.begin('run-1');
    clockMs = 100;
    timing.observe({ type: 'message/text_delta', messageId: 'm1', delta: 'old', runId: 'run-old' });
    expect(timing.observe(usage({ runId: 'run-old' }))).toEqual(usage({ runId: 'run-old' }));
    timing.observe({ type: 'message/text_delta', messageId: 'm1', delta: 'current' });
    expect(timing.observe(usage())).toMatchObject({ measurement: { firstTokenMs: 100 } });
    timing.end();
    expect(timing.observe(replay)).toBe(replay);
    timing.begin('run-2');
    clockMs = 500;
    timing.observe({ type: 'message/text_delta', messageId: 'm2', delta: 'next' });
    expect(timing.observe(usage({ runId: 'run-2' }))).toMatchObject({ measurement: { firstTokenMs: 400 } });
  });
});

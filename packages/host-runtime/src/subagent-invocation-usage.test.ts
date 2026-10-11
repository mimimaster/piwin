import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import {
  applySubagentUsageEvent,
  createSubagentUsageTracker,
  subagentUsageEquals,
} from './subagent-invocation-usage.js';
import { isSubagentInvocationEvent } from './subagent-invocation-activity.js';

function finalized(id: string, totalTokens: number): AgentEvent {
  return {
    type: 'usage/finalized',
    measurement: {
      measurementId: id,
      sessionId: 'child',
      messageId: `msg-${id}`,
      totalTokens,
      recordedAt: '2026-10-11T09:00:00.000Z',
    },
  };
}

describe('subagent invocation usage tracker', () => {
  it('accumulates distinct tool calls and finalized request tokens across a run', () => {
    const tracker = createSubagentUsageTracker();
    const events: AgentEvent[] = [
      { type: 'tool/start', toolCallId: 'a', toolName: 'read' },
      finalized('m1', 1000),
      { type: 'tool/start', toolCallId: 'b', toolName: 'grep' },
      { type: 'tool/end', toolCallId: 'b', isError: false },
      finalized('m2', 1500),
    ];
    const changed = events.map((event) => applySubagentUsageEvent(tracker, event));
    expect(changed).toEqual([true, true, true, false, true]);
    expect(tracker.usage).toEqual({ toolCalls: 2, totalTokens: 2500, requests: 2 });
  });

  it('ignores replayed tool starts and measurements', () => {
    const tracker = createSubagentUsageTracker();
    applySubagentUsageEvent(tracker, { type: 'tool/start', toolCallId: 'a', toolName: 'read' });
    applySubagentUsageEvent(tracker, finalized('m1', 10));
    expect(
      applySubagentUsageEvent(tracker, { type: 'tool/start', toolCallId: 'a', toolName: 'read' }),
    ).toBe(false);
    expect(applySubagentUsageEvent(tracker, finalized('m1', 10))).toBe(false);
    expect(applySubagentUsageEvent(tracker, finalized('bad', Number.NaN))).toBe(false);
    expect(tracker.usage).toEqual({ toolCalls: 1, totalTokens: 10, requests: 1 });
  });

  it('continues from the persisted projection when reseeded', () => {
    const tracker = createSubagentUsageTracker({ toolCalls: 4, totalTokens: 900, requests: 3 });
    applySubagentUsageEvent(tracker, { type: 'tool/start', toolCallId: 'z', toolName: 'read' });
    expect(tracker.usage).toEqual({ toolCalls: 5, totalTokens: 900, requests: 3 });
  });

  it('compares usage by value and treats a missing side as different', () => {
    expect(subagentUsageEquals(undefined, undefined)).toBe(true);
    expect(subagentUsageEquals({ toolCalls: 1, totalTokens: 2, requests: 1 }, undefined)).toBe(false);
    expect(
      subagentUsageEquals(
        { toolCalls: 1, totalTokens: 2, requests: 1 },
        { toolCalls: 1, totalTokens: 2, requests: 1 },
      ),
    ).toBe(true);
  });

  it('routes counter sources and activity transitions to the orchestrator, nothing else', () => {
    expect(isSubagentInvocationEvent(finalized('m', 1))).toBe(true);
    expect(isSubagentInvocationEvent({ type: 'tool/start', toolCallId: 'a', toolName: 'read' })).toBe(
      true,
    );
    expect(isSubagentInvocationEvent({ type: 'tool/update', toolCallId: 'a', delta: '' })).toBe(false);
  });
});

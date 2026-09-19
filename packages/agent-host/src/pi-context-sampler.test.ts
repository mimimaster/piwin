import { describe, expect, it } from 'vitest';
import type { AgentEvent, AssistantUsageMeasurement, ContextMeasurement } from '@piwin/contracts';
import { createPiSessionEventMapper } from './event-map.js';
import {
  normalizeAgentEventIds,
  normalizeGenerationMessageId,
  type GenerationIdentityContext,
} from './generation-identity.js';
import {
  applyAssistantRequestTiming,
  createPiContextSampler,
  enrichPiCompactionDuration,
  noteAssistantRequestTiming,
  type AssistantRequestTimingState,
  type PiCompactionTimingState,
  type PiContextSampler,
} from './pi-context-sampler.js';

const identity: GenerationIdentityContext = {
  sessionId: 'session-1',
  runtimeGenerationId: 'gen-a',
};

const sampledAt = '2026-08-30T12:00:00.000Z';
const normalizedMessageId = normalizeGenerationMessageId(identity, 'm-1');

function createSampler(
  overrides: {
    runtimeGenerationId?: string;
    getContextUsage?: () => { tokens: number | null; contextWindow: number } | undefined;
    nowMs?: () => number;
  } = {},
): PiContextSampler {
  return createPiContextSampler({
    sessionId: identity.sessionId,
    runtimeGenerationId: overrides.runtimeGenerationId ?? identity.runtimeGenerationId,
    getRunId: () => 'run-1',
    now: () => new Date(sampledAt),
    ...(overrides.getContextUsage ? { getContextUsage: overrides.getContextUsage } : {}),
    ...(overrides.nowMs ? { nowMs: overrides.nowMs } : {}),
  });
}

function replay(sampler: PiContextSampler, rawEvents: unknown[]): AgentEvent[] {
  const mapper = createPiSessionEventMapper();
  const out: AgentEvent[] = [];
  for (const raw of rawEvents) {
    const mapped = mapper
      .map(raw)
      .map((event) => normalizeAgentEventIds(event, identity));
    out.push(...mapped, ...sampler.observe({ mappedEvents: mapped, raw }));
  }
  return out;
}

function measurements(events: AgentEvent[]): ContextMeasurement[] {
  return events.flatMap((event) =>
    event.type === 'context/measurement' ? [event.measurement] : [],
  );
}

function finalized(events: AgentEvent[]): AssistantUsageMeasurement[] {
  return events.flatMap((event) =>
    event.type === 'usage/finalized' ? [event.measurement] : [],
  );
}

function knownTokens(events: AgentEvent[]): number[] {
  return measurements(events).flatMap((measurement) =>
    measurement.occupancy.kind === 'known' ? [measurement.occupancy.tokensUsed] : [],
  );
}

const validUsage = {
  input: 80_000,
  output: 10_000,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 90_000,
};

describe('pi-context-sampler', () => {
  it('fills a missing compaction duration from the matching start event', () => {
    const state: PiCompactionTimingState = {};
    enrichPiCompactionDuration({ type: 'compaction/start' }, state, 100);
    expect(
      enrichPiCompactionDuration({ type: 'compaction/end', ok: true }, state, 145),
    ).toEqual({ type: 'compaction/end', ok: true, durationMs: 45 });
    expect(state.startedAtMs).toBeUndefined();
  });

  it('keeps the last trusted occupancy when compaction fails', () => {
    let contextTokens: number | null = 90_000;
    const sampler = createSampler({
      getContextUsage: () => ({ tokens: contextTokens, contextWindow: 128_000 }),
    });
    replay(sampler, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          usage: validUsage,
          stopReason: 'stop',
        },
      },
    ]);

    contextTokens = null;
    const failed = replay(sampler, [
      { type: 'compaction_start', reason: 'overflow' },
      {
        type: 'compaction_end',
        reason: 'overflow',
        aborted: false,
        errorMessage: 'Auto-compaction failed: provider unavailable',
        result: undefined,
      },
    ]);

    expect(measurements(failed).at(-1)?.occupancy).toMatchObject({
      kind: 'known',
      tokensUsed: 90_000,
    });
  });

  it('records the stable product boundary from a successful compaction result', () => {
    const sampler = createSampler({
      getContextUsage: () => ({ tokens: 40_000, contextWindow: 128_000 }),
    });
    const events = replay(sampler, [
      { type: 'compaction_start', reason: 'manual' },
      {
        type: 'compaction_end',
        reason: 'manual',
        result: {
          summary: 'summary',
          firstKeptEntryId: 'entry-42',
          tokensBefore: 80_000,
          estimatedTokensAfter: 40_000,
        },
      },
    ]);

    expect(measurements(events).at(-1)?.contextBoundary.compactionBoundary).toBe(
      'compact:80000:40000',
    );
  });

  it('T07: tokensUsed increases across text, thinking, and tool-loop without waiting for agent_end', () => {
    const sampler = createSampler({
      getContextUsage: () => ({ tokens: 80_000, contextWindow: 128_000 }),
    });
    const text = replay(sampler, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'text_delta', delta: 'abcd'.repeat(10) },
      },
    ]);
    const thinking = replay(sampler, [
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'abcd'.repeat(8) },
      },
    ]);
    const tool = replay(sampler, [
      {
        type: 'tool_execution_start',
        toolCallId: 'tool-1',
        toolName: 'read',
        args: { path: 'README.md' },
      },
    ]);
    const afterToolResult = replay(sampler, [
      {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'read',
        isError: false,
        output: 'abcd'.repeat(20),
      },
    ]);

    const textTokens = knownTokens(text).at(-1);
    const thinkingTokens = knownTokens(thinking).at(-1);
    const toolTokens = knownTokens(tool).at(-1);
    const loopTokens = knownTokens(afterToolResult).at(-1);
    expect(textTokens).toBeGreaterThan(80_000);
    expect(thinkingTokens).toBeGreaterThan(textTokens ?? 0);
    expect(toolTokens).toBeGreaterThan(thinkingTokens ?? 0);
    expect(loopTokens).toBeGreaterThan(toolTokens ?? 0);

    const nextRequest = replay(sampler, [
      { type: 'message_start', messageId: 'm-2', role: 'assistant' },
      {
        type: 'message_end',
        messageId: 'm-2',
        message: {
          role: 'assistant',
          id: 'm-2',
          usage: { input: 80_400, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 80_450 },
          stopReason: 'stop',
        },
      },
    ]);
    expect(knownTokens(nextRequest).at(-1)).toBe(80_450);
    expect(knownTokens(nextRequest).at(-1)).not.toBe(80_000 + 80_450);
  });

  it('T11: drops a sample tagged with generation A while the sampler is on generation B', () => {
    const sampler = createSampler({ runtimeGenerationId: 'gen-b' });
    const events = sampler.observe({
      runtimeGenerationId: 'gen-a',
      mappedEvents: [
        { type: 'message/text_delta', messageId: normalizedMessageId, delta: 'hello' },
      ],
    });
    expect(measurements(events)).toEqual([]);
  });

  it('T12: error/aborted all-zero does not emit known occupancy 0; real billable usage still finalizes', () => {
    const zeroError = createSampler();
    const zeroEvents = replay(zeroError, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: 'error',
        },
      },
    ]);
    expect(knownTokens(zeroEvents)).toEqual([]);
    expect(
      measurements(zeroEvents).some(
        (measurement) =>
          measurement.occupancy.kind === 'known' && measurement.occupancy.tokensUsed === 0,
      ),
    ).toBe(false);
    expect(finalized(zeroEvents)).toEqual([]);

    const abortedBillable = createSampler();
    const abortedEvents = replay(abortedBillable, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          model: 'gpt-test',
          usage: { input: 40, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 48 },
          stopReason: 'aborted',
        },
      },
    ]);
    expect(knownTokens(abortedEvents)).toEqual([]);
    expect(finalized(abortedEvents)).toHaveLength(1);
    expect(finalized(abortedEvents)[0]).toMatchObject({
      sessionId: 'session-1',
      messageId: normalizedMessageId,
      totalTokens: 48,
      stopReason: 'aborted',
    });
  });

  it('T12: aborted usage after a valid baseline emits unknown, not last+trailing', () => {
    const sampler = createSampler();
    replay(sampler, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          usage: validUsage,
          stopReason: 'stop',
        },
      },
    ]);
    const aborted = replay(sampler, [
      { type: 'message_start', messageId: 'm-fail', role: 'assistant' },
      {
        type: 'message_update',
        messageId: 'm-fail',
        assistantMessageEvent: { type: 'text_delta', delta: 'partial output that must not stay known' },
      },
      {
        type: 'message_end',
        messageId: 'm-fail',
        message: {
          role: 'assistant',
          id: 'm-fail',
          usage: { input: 40, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 48 },
          stopReason: 'aborted',
        },
      },
    ]);
    expect(measurements(aborted).at(-1)?.occupancy).toEqual({
      kind: 'unknown',
      reason: 'error-or-aborted-usage',
    });
    expect(finalized(aborted)).toHaveLength(1);
  });

  it('does not add tool-call args after a measured message_end already includes them', () => {
    const sampler = createSampler();
    const ended = replay(sampler, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          usage: validUsage,
          stopReason: 'stop',
        },
      },
    ]);
    expect(knownTokens(ended).at(-1)).toBe(90_000);
    const afterToolStart = replay(sampler, [
      {
        type: 'tool_execution_start',
        toolCallId: 'tool-1',
        toolName: 'read',
        args: { path: 'a'.repeat(400) },
      },
    ]);
    expect(knownTokens(afterToolStart).at(-1)).toBe(90_000);
  });

  it('replaces streaming tool-call argument snapshots instead of concatenating them', () => {
    const sampler = createSampler({
      getContextUsage: () => ({ tokens: 1_000, contextWindow: 8_000 }),
    });
    const firstArgs = { path: 'ab' };
    const secondArgs = { path: 'x'.repeat(80) };
    replay(sampler, [{ type: 'message_start', messageId: 'm-1', role: 'assistant' }]);
    replay(sampler, [
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'tool_call', arguments: firstArgs },
      },
    ]);
    const second = replay(sampler, [
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'tool_call', arguments: secondArgs },
      },
    ]);
    const snapshotTokens = Math.ceil(JSON.stringify(secondArgs).length / 4);
    const concatTokens =
      Math.ceil(JSON.stringify(firstArgs).length / 4) + snapshotTokens;
    expect(knownTokens(second).at(-1)).toBe(1_000 + snapshotTokens);
    expect(knownTokens(second).at(-1)).not.toBe(1_000 + concatTokens);
  });

  it('invalidates the measured baseline on model change', () => {
    const sampler = createSampler();
    replay(sampler, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          usage: validUsage,
          stopReason: 'stop',
        },
      },
    ]);
    const invalidated = sampler.invalidateBaseline();
    expect(measurements(invalidated).at(-1)?.occupancy.kind).toBe('unknown');
    const afterSwitch = replay(sampler, [
      { type: 'message_start', messageId: 'm-2', role: 'assistant' },
      {
        type: 'message_update',
        messageId: 'm-2',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
    ]);
    expect(knownTokens(afterSwitch)).toEqual([]);
    expect(measurements(afterSwitch).at(-1)?.occupancy.kind).toBe('unknown');
  });

  it('T13: message_end and agent_end mint the same measurementId', () => {
    const sampler = createSampler();
    const events = replay(sampler, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          model: 'gpt-test',
          usage: validUsage,
          stopReason: 'stop',
        },
      },
      {
        type: 'agent_end',
        sessionId: 'session-1',
        messages: [
          {
            role: 'assistant',
            id: 'm-1',
            model: 'gpt-test',
            usage: validUsage,
            stopReason: 'stop',
          },
        ],
      },
    ]);
    const ids = finalized(events).map((measurement) => measurement.measurementId);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(
      `${identity.sessionId}:${identity.runtimeGenerationId}:${normalizedMessageId}`,
    );
  });

  it('emits unknown occupancy after compaction when getContextUsage returns null tokens', () => {
    const sampler = createSampler({
      getContextUsage: () => ({ tokens: null, contextWindow: 128_000 }),
    });
    const events = replay(sampler, [
      { type: 'compaction_start', reason: 'manual' },
      { type: 'compaction_end', reason: 'manual', ok: true, aborted: false },
    ]);
    expect(measurements(events).at(-1)?.occupancy).toEqual({
      kind: 'unknown',
      reason: 'post-compaction',
    });
  });

  it('increments sampleSequence at capture and sets messageId from first response evidence', () => {
    const sampler = createSampler({
      getContextUsage: () => ({ tokens: 1_000, contextWindow: 8_000 }),
    });
    const events = replay(sampler, [
      { type: 'message_start', messageId: 'm-1', role: 'assistant' },
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'plan' },
      },
    ]);
    const samples = measurements(events);
    expect(samples[0]?.messageId).toBe(normalizedMessageId);
    expect(samples.map((sample) => sample.sampleSequence)).toEqual(
      samples.map((_, index) => index + 1),
    );
  });

  it('notes first visible output after assistant message/start', () => {
    const state: AssistantRequestTimingState = {};
    noteAssistantRequestTiming({ type: 'message/start', messageId: 'm-1', role: 'user' }, state, 1);
    expect(state.startedAtMs).toBeUndefined();
    noteAssistantRequestTiming(
      { type: 'message/start', messageId: 'm-1', role: 'assistant' },
      state,
      1000,
    );
    expect(state.startedAtMs).toBe(1000);
    noteAssistantRequestTiming(
      { type: 'message/text_delta', messageId: 'm-1', delta: '' },
      state,
      1100,
    );
    expect(state.firstTokenAtMs).toBeUndefined();
    noteAssistantRequestTiming(
      { type: 'message/thinking_delta', messageId: 'm-1', delta: 'plan' },
      state,
      1200,
    );
    expect(state.firstTokenAtMs).toBe(1200);
    noteAssistantRequestTiming(
      { type: 'message/text_delta', messageId: 'm-1', delta: 'hello' },
      state,
      1500,
    );
    expect(state.firstTokenAtMs).toBe(1200);
  });

  it('does not treat a text snapshot as the first token', () => {
    const state: AssistantRequestTimingState = {};
    noteAssistantRequestTiming(
      { type: 'message/start', messageId: 'm-1', role: 'assistant' },
      state,
      1000,
    );
    noteAssistantRequestTiming(
      { type: 'message/text_snapshot', messageId: 'm-1', text: 'hello' },
      state,
      1100,
    );
    expect(state.firstTokenAtMs).toBeUndefined();
  });

  it('does not stamp zero-elapsed reconstructions', () => {
    const measurement: AssistantUsageMeasurement = {
      measurementId: 'm',
      sessionId: 's',
      messageId: 'm-1',
      totalTokens: 10,
      recordedAt: sampledAt,
    };
    expect(
      applyAssistantRequestTiming(measurement, { startedAtMs: 1000, firstTokenAtMs: 1000 }, 1000),
    ).toEqual(measurement);
  });

  it('fills missing firstTokenMs and durationMs from wall clock', () => {
    const measurement: AssistantUsageMeasurement = {
      measurementId: 'm',
      sessionId: 's',
      messageId: 'm-1',
      totalTokens: 10,
      recordedAt: sampledAt,
    };
    expect(
      applyAssistantRequestTiming(measurement, { startedAtMs: 1000, firstTokenAtMs: 1350 }, 3000),
    ).toMatchObject({ firstTokenMs: 350, durationMs: 2000 });
  });

  it('prefers the stream clock over provider-reported timing', () => {
    const measurement: AssistantUsageMeasurement = {
      measurementId: 'm',
      sessionId: 's',
      messageId: 'm-1',
      totalTokens: 10,
      recordedAt: sampledAt,
      durationMs: 9000,
      firstTokenMs: 12,
    };
    expect(
      applyAssistantRequestTiming(measurement, { startedAtMs: 1000, firstTokenAtMs: 1350 }, 3000),
    ).toMatchObject({ firstTokenMs: 350, durationMs: 2000 });
  });

  it('omits firstTokenMs when the first increment arrives at finalize', () => {
    const measurement: AssistantUsageMeasurement = {
      measurementId: 'm',
      sessionId: 's',
      messageId: 'm-1',
      totalTokens: 10,
      recordedAt: sampledAt,
    };
    expect(
      applyAssistantRequestTiming(measurement, { startedAtMs: 1000, firstTokenAtMs: 3000 }, 3000),
    ).toEqual({
      measurementId: 'm',
      sessionId: 's',
      messageId: 'm-1',
      totalTokens: 10,
      recordedAt: sampledAt,
      durationMs: 2000,
    });
  });

  it('drops a short duration that cannot explain a large completion', () => {
    const measurement: AssistantUsageMeasurement = {
      measurementId: 'm',
      sessionId: 's',
      messageId: 'm-1',
      totalTokens: 418,
      completionTokens: 418,
      recordedAt: sampledAt,
      durationMs: 1,
    };
    expect(
      applyAssistantRequestTiming(measurement, { startedAtMs: 1000 }, 1001),
    ).toEqual({
      measurementId: 'm',
      sessionId: 's',
      messageId: 'm-1',
      totalTokens: 418,
      completionTokens: 418,
      recordedAt: sampledAt,
    });
  });

  it('stamps firstTokenMs and durationMs from the stream clock when the provider omits them', () => {
    let nowMs = 1_000;
    const sampler = createSampler({ nowMs: () => nowMs });
    const mapper = createPiSessionEventMapper();
    const step = (raw: unknown, t: number): AgentEvent[] => {
      nowMs = t;
      const mapped = mapper
        .map(raw)
        .map((event) => normalizeAgentEventIds(event, identity));
      return [...mapped, ...sampler.observe({ mappedEvents: mapped, raw })];
    };
    step({ type: 'message_start', messageId: 'm-1', role: 'assistant' }, 1_000);
    step(
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
      1_350,
    );
    const events = step(
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          usage: validUsage,
          stopReason: 'stop',
        },
      },
      3_000,
    );
    expect(finalized(events)[0]).toMatchObject({ firstTokenMs: 350, durationMs: 2_000 });
  });

  it('prefers the stream clock over usage.durationMs on usage/finalized', () => {
    let nowMs = 1_000;
    const sampler = createSampler({ nowMs: () => nowMs });
    const mapper = createPiSessionEventMapper();
    const step = (raw: unknown, t: number): AgentEvent[] => {
      nowMs = t;
      const mapped = mapper
        .map(raw)
        .map((event) => normalizeAgentEventIds(event, identity));
      return [...mapped, ...sampler.observe({ mappedEvents: mapped, raw })];
    };
    step({ type: 'message_start', messageId: 'm-1', role: 'assistant' }, 1_000);
    step(
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
      1_350,
    );
    const events = step(
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          usage: { ...validUsage, durationMs: 9_000, firstTokenMs: 12 },
          stopReason: 'stop',
        },
      },
      3_000,
    );
    expect(finalized(events)[0]).toMatchObject({ firstTokenMs: 350, durationMs: 2_000 });
  });

  it('uses message.timestamp for duration when start and end arrive together', () => {
    let nowMs = 9_000;
    const sampler = createSampler({ nowMs: () => nowMs });
    const mapper = createPiSessionEventMapper();
    const step = (raw: unknown, t: number): AgentEvent[] => {
      nowMs = t;
      const mapped = mapper
        .map(raw)
        .map((event) => normalizeAgentEventIds(event, identity));
      return [...mapped, ...sampler.observe({ mappedEvents: mapped, raw })];
    };
    step({ type: 'message_start', messageId: 'm-1', role: 'assistant' }, 9_000);
    step(
      {
        type: 'message_update',
        messageId: 'm-1',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
      9_000,
    );
    const events = step(
      {
        type: 'message_end',
        messageId: 'm-1',
        message: {
          role: 'assistant',
          id: 'm-1',
          timestamp: 1_000,
          usage: validUsage,
          stopReason: 'stop',
        },
      },
      9_000,
    );
    const measurement = finalized(events)[0];
    expect(measurement).toMatchObject({ durationMs: 8_000 });
    expect(measurement?.firstTokenMs).toBeUndefined();
  });
});

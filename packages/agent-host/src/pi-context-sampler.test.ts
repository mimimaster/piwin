import { describe, expect, it } from 'vitest';
import type { AgentEvent, AssistantUsageMeasurement, ContextMeasurement } from '@piwin/contracts';
import { createPiSessionEventMapper } from './event-map.js';
import {
  normalizeAgentEventIds,
  normalizeGenerationMessageId,
  type GenerationIdentityContext,
} from './generation-identity.js';
import { createPiContextSampler, type PiContextSampler } from './pi-context-sampler.js';

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
  } = {},
): PiContextSampler {
  return createPiContextSampler({
    sessionId: identity.sessionId,
    runtimeGenerationId: overrides.runtimeGenerationId ?? identity.runtimeGenerationId,
    getRunId: () => 'run-1',
    now: () => new Date(sampledAt),
    ...(overrides.getContextUsage ? { getContextUsage: overrides.getContextUsage } : {}),
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
});

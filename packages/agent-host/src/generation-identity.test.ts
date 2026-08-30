import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import {
  assistantUsageMeasurementId,
  normalizeAgentEventIds,
  normalizeGenerationMessageId,
  normalizeGenerationToolCallId,
} from './generation-identity.js';
import type { GenerationIdentityContext } from './generation-identity.js';

const contextA: GenerationIdentityContext = {
  sessionId: 'session-1',
  runtimeGenerationId: 'gen-a',
};

const contextB: GenerationIdentityContext = {
  sessionId: 'session-1',
  runtimeGenerationId: 'gen-b',
};

describe('generation-identity', () => {
  it('builds a stable usage measurement id from session, generation, and message', () => {
    expect(
      assistantUsageMeasurementId({
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-a',
        messageId: 'piw-m-1',
      }),
    ).toBe('session-1:gen-a:piw-m-1');
    expect(
      assistantUsageMeasurementId({
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-a',
        messageId: 'piw-m-1',
      }),
    ).toBe(
      assistantUsageMeasurementId({
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-a',
        messageId: 'piw-m-1',
      }),
    );
  });

  it('maps the same backend id within one generation to the same opaque product id', () => {
    const first = normalizeGenerationMessageId(contextA, 'pi-message-2');
    const second = normalizeGenerationMessageId(contextA, 'pi-message-2');
    expect(first).toBe(second);
    expect(first.startsWith('piw-m-')).toBe(true);
  });

  it('maps the same backend id across generations to different product ids', () => {
    const genA = normalizeGenerationMessageId(contextA, 'pi-message-2');
    const genB = normalizeGenerationMessageId(contextB, 'pi-message-2');
    expect(genA).not.toBe(genB);
  });

  it('scopes tool-call ids by generation', () => {
    const genA = normalizeGenerationToolCallId(contextA, 'call_00');
    const genB = normalizeGenerationToolCallId(contextB, 'call_00');
    expect(genA).not.toBe(genB);
    expect(genA.startsWith('piw-t-')).toBe(true);
  });

  it('normalizes message ids on AgentEvents', () => {
    const event: AgentEvent = {
      type: 'message/text_delta',
      messageId: 'pi-message-2',
      delta: 'hello',
    };
    const normalized = normalizeAgentEventIds(event, contextA);
    expect(normalized).toMatchObject({
      type: 'message/text_delta',
      delta: 'hello',
    });
    if (normalized.type === 'message/text_delta') {
      expect(normalized.messageId).toBe(normalizeGenerationMessageId(contextA, 'pi-message-2'));
      expect(normalized.messageId).not.toBe('pi-message-2');
    }
  });

  it('normalizes tool-call ids on tool events', () => {
    const event: AgentEvent = {
      type: 'tool/start',
      toolCallId: 'call_00',
      toolName: 'bash',
      responseMessageId: 'pi-message-2',
    };
    const normalized = normalizeAgentEventIds(event, contextB);
    if (normalized.type === 'tool/start') {
      expect(normalized.toolCallId).toBe(normalizeGenerationToolCallId(contextB, 'call_00'));
      expect(normalized.responseMessageId).toBe(
        normalizeGenerationMessageId(contextB, 'pi-message-2'),
      );
    }
  });

  it('normalizes permission request ids', () => {
    const event: AgentEvent = {
      type: 'permission/request',
      requestId: 'permission-1',
      action: 'shell',
      detail: 'run command',
      defaultDecision: 'ask',
    };
    const normalized = normalizeAgentEventIds(event, contextA);
    if (normalized.type === 'permission/request') {
      expect(normalized.requestId).not.toBe('permission-1');
      expect(normalized.requestId.startsWith('piw-p-')).toBe(true);
    }
  });

  it('leaves non-identity events unchanged', () => {
    const event: AgentEvent = {
      type: 'message/end',
      messageId: 'pi-message-2',
    };
    // message/end carries a message id and must be normalized.
    const normalized = normalizeAgentEventIds(event, contextA);
    expect(normalized).toMatchObject({ type: 'message/end' });

    const usage: AgentEvent = {
      type: 'usage/update',
      sessionId: 'session-1',
      usage: {
        sessionId: 'session-1',
        source: 'host-estimate',
        totalTokens: 10,
        promptTokens: 5,
        completionTokens: 5,
        updatedAt: new Date().toISOString(),
      },
    };
    expect(normalizeAgentEventIds(usage, contextA)).toBe(usage);
    const measurement: AgentEvent = {
      type: 'context/measurement',
      measurement: {
        sessionId: 'session-1',
        sampleSequence: 1,
        occupancy: { kind: 'unknown', reason: 'no-measurement' },
        contextBoundary: { activeLeafMessageId: null },
        sampledAt: '2026-08-30T00:00:00.000Z',
      },
    };
    expect(normalizeAgentEventIds(measurement, contextA)).toBe(measurement);
  });

  it('two generations emitting the same naked id produce distinct rows', () => {
    const genAStart: AgentEvent = {
      type: 'message/start',
      messageId: 'pi-message-2',
      role: 'assistant',
    };
    const genBStart: AgentEvent = {
      type: 'message/start',
      messageId: 'pi-message-2',
      role: 'assistant',
    };
    const a = normalizeAgentEventIds(genAStart, contextA);
    const b = normalizeAgentEventIds(genBStart, contextB);
    if (a.type === 'message/start' && b.type === 'message/start') {
      expect(a.messageId).not.toBe(b.messageId);
    }
  });
});

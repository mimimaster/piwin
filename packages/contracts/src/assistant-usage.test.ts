import { describe, expect, it } from 'vitest';
import {
  parseAssistantUsageMeasurement,
  type AssistantUsageMeasurement,
} from './assistant-usage.js';

function validMeasurement(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    measurementId: 'session-1:gen-1:msg-1',
    sessionId: 'session-1',
    messageId: 'msg-1',
    totalTokens: 42,
    recordedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('assistant usage measurement contracts', () => {
  it('parses a finalized request measurement', () => {
    const parsed = parseAssistantUsageMeasurement(
      validMeasurement({
        runId: 'run-1',
        runtimeGenerationId: 'gen-1',
        modelId: 'gpt-test',
        promptTokens: 10,
        completionTokens: 32,
        cacheReadTokens: 4,
        cacheWriteTokens: 2,
        durationMs: 80,
        thinkingLevel: 'high',
        stopReason: 'stop',
      }),
    );
    expect(parsed).toMatchObject({
      measurementId: 'session-1:gen-1:msg-1',
      sessionId: 'session-1',
      messageId: 'msg-1',
      totalTokens: 42,
      promptTokens: 10,
      thinkingLevel: 'high',
    });
    const roundTrip: AssistantUsageMeasurement | null = parseAssistantUsageMeasurement(parsed);
    expect(roundTrip).toEqual(parsed);
  });

  it('rejects illegal totals and missing identity fields', () => {
    expect(parseAssistantUsageMeasurement(validMeasurement({ totalTokens: -1 }))).toBeNull();
    expect(
      parseAssistantUsageMeasurement(validMeasurement({ totalTokens: Number.POSITIVE_INFINITY })),
    ).toBeNull();
    expect(parseAssistantUsageMeasurement(validMeasurement({ totalTokens: Number.NaN }))).toBeNull();
    expect(parseAssistantUsageMeasurement(validMeasurement({ promptTokens: -3 }))).toBeNull();
    expect(parseAssistantUsageMeasurement(validMeasurement({ measurementId: '' }))).toBeNull();
    expect(parseAssistantUsageMeasurement(validMeasurement({ messageId: 1 }))).toBeNull();
    expect(parseAssistantUsageMeasurement(null)).toBeNull();
  });
});

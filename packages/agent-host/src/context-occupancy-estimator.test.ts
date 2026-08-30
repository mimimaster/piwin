import { describe, expect, it } from 'vitest';
import type { ContextOccupancy } from '@piwin/contracts';
import {
  estimateContextOccupancy,
  estimateTokensFromChars,
  isValidOccupancyBaseline,
  windowFillTokens,
  type EstimateContextOccupancyInput,
} from './context-occupancy-estimator.js';

const sampledAt = '2026-08-30T00:00:00.000Z';

function known(occupancy: ContextOccupancy): Extract<ContextOccupancy, { kind: 'known' }> {
  expect(occupancy.kind).toBe('known');
  if (occupancy.kind !== 'known') {
    throw new Error('expected known occupancy');
  }
  return occupancy;
}

function estimate(overrides: Partial<EstimateContextOccupancyInput> = {}): ContextOccupancy {
  return estimateContextOccupancy({ sampledAt, ...overrides });
}

describe('context-occupancy-estimator', () => {
  it('T08: input 80k + output 10k, no cache → known tokensUsed 90k', () => {
    const occupancy = known(
      estimate({
        currentRequest: { inputTokens: 80_000, outputTokens: 10_000 },
      }),
    );
    expect(occupancy.tokensUsed).toBe(90_000);
    expect(occupancy.quality).toBe('measured');
    expect(occupancy.coverage).toBe('complete');
  });

  it('does not add cache twice when it is already inside the Pi/provider total', () => {
    const occupancy = known(
      estimate({
        currentRequest: {
          inputTokens: 80_000,
          outputTokens: 10_000,
          cacheReadTokens: 5_000,
          cacheWriteTokens: 1_000,
          totalTokens: 96_000,
        },
      }),
    );
    expect(occupancy.tokensUsed).toBe(96_000);
    expect(windowFillTokens({
      inputTokens: 80_000,
      outputTokens: 10_000,
      cacheReadTokens: 5_000,
      cacheWriteTokens: 1_000,
      totalTokens: 96_000,
    })).toBe(96_000);
  });

  it('adds cache once when the total does not already include it', () => {
    const occupancy = known(
      estimate({
        currentRequest: {
          inputTokens: 80_000,
          outputTokens: 10_000,
          cacheReadTokens: 5_000,
          cacheWriteTokens: 1_000,
          cacheIncludedInTotal: false,
        },
      }),
    );
    expect(occupancy.tokensUsed).toBe(96_000);
  });

  it('T07: streaming phases increase occupancy without summing every request input', () => {
    const afterText = known(
      estimate({
        lastCompletedRequest: { inputTokens: 80_000, outputTokens: 10_000, totalTokens: 90_000 },
        trailing: { streamingOutputTokens: 25 },
      }),
    );
    const afterThinking = known(
      estimate({
        lastCompletedRequest: { inputTokens: 80_000, outputTokens: 10_000, totalTokens: 90_000 },
        trailing: { streamingOutputTokens: 40 },
      }),
    );
    const afterToolLoop = known(
      estimate({
        lastCompletedRequest: { inputTokens: 80_000, outputTokens: 10_000, totalTokens: 90_000 },
        trailing: { toolResultTokens: 80, streamingOutputTokens: 12 },
      }),
    );
    expect(afterText.tokensUsed).toBe(90_025);
    expect(afterThinking.tokensUsed).toBeGreaterThan(afterText.tokensUsed);
    expect(afterToolLoop.tokensUsed).toBe(90_092);
    expect(afterText.quality).toBe('estimated');

    const nextRequest = known(
      estimate({
        currentRequest: { inputTokens: 90_092, outputTokens: 1_000, totalTokens: 91_092 },
        lastCompletedRequest: { inputTokens: 80_000, outputTokens: 10_000, totalTokens: 90_000 },
        trailing: { toolResultTokens: 80, includedInMeasuredInput: true },
      }),
    );
    expect(nextRequest.tokensUsed).toBe(91_092);
    expect(nextRequest.tokensUsed).not.toBe(90_000 + 91_092);
  });

  it('T09: does not add a tool result that is already inside the measured baseline', () => {
    const occupancy = known(
      estimate({
        lastCompletedRequest: { inputTokens: 90_500, outputTokens: 0, totalTokens: 90_500 },
        trailing: { toolResultTokens: 500, includedInMeasuredInput: true, streamingOutputTokens: 20 },
      }),
    );
    expect(occupancy.tokensUsed).toBe(90_520);
  });

  it('T10: no measurement → unknown; missing image estimate → partial; zero usage is not known 0', () => {
    expect(estimate({})).toEqual({ kind: 'unknown', reason: 'no-measurement' });

    const partial = known(
      estimate({
        observedContext: {
          systemPromptTokens: 100,
          toolDefinitionTokens: 200,
          messageTokens: 300,
          missingImageEstimate: true,
        },
      }),
    );
    expect(partial.tokensUsed).toBe(600);
    expect(partial.quality).toBe('estimated');
    expect(partial.coverage).toBe('partial');

    expect(
      estimate({
        currentRequest: { inputTokens: 0, outputTokens: 0, totalTokens: 0, stopReason: 'stop' },
      }),
    ).toEqual({ kind: 'unknown', reason: 'invalid-zero-usage' });
  });

  it('does not use last user text + reply as a stand-in for the whole context', () => {
    expect(
      estimate({
        trailing: { userTokens: 12, streamingOutputTokens: 8 },
      }),
    ).toEqual({ kind: 'unknown', reason: 'no-measurement' });
  });

  it('marks unobserved content partial when a baseline exists, unknown when it does not', () => {
    const partial = known(
      estimate({
        lastCompletedRequest: { inputTokens: 80_000, outputTokens: 10_000, totalTokens: 90_000 },
        trailing: { unobserved: true, streamingOutputTokens: 4 },
      }),
    );
    expect(partial.coverage).toBe('partial');
    expect(partial.tokensUsed).toBe(90_004);

    expect(
      estimate({
        trailing: { unobserved: true, streamingOutputTokens: 4 },
      }),
    ).toEqual({ kind: 'unknown', reason: 'unobserved-context' });
  });

  it('replaces an older estimate with a later measured sample and allows downward calibration', () => {
    const occupancy = known(
      estimate({
        currentRequest: { inputTokens: 70_000, outputTokens: 5_000, totalTokens: 75_000 },
        lastCompletedRequest: { inputTokens: 80_000, outputTokens: 10_000, totalTokens: 90_000 },
        trailing: { streamingOutputTokens: 9_000 },
      }),
    );
    expect(occupancy.tokensUsed).toBe(75_000);
    expect(occupancy.quality).toBe('measured');
  });

  it('does not replace occupancy with error, aborted, or all-zero usage', () => {
    expect(isValidOccupancyBaseline({ totalTokens: 0, stopReason: 'stop' })).toBe(false);
    expect(
      isValidOccupancyBaseline({ inputTokens: 80_000, outputTokens: 10_000, stopReason: 'aborted' }),
    ).toBe(false);
    expect(
      isValidOccupancyBaseline({ inputTokens: 80_000, outputTokens: 10_000, stopReason: 'error' }),
    ).toBe(false);

    expect(
      estimate({
        currentRequest: { inputTokens: 12, outputTokens: 3, totalTokens: 15, stopReason: 'error' },
        lastCompletedRequest: { inputTokens: 80_000, outputTokens: 10_000, totalTokens: 90_000 },
      }),
    ).toEqual({ kind: 'unknown', reason: 'error-or-aborted-usage' });

    expect(
      estimate({
        currentRequest: { inputTokens: 12, outputTokens: 3, totalTokens: 15, stopReason: 'aborted' },
      }),
    ).toEqual({ kind: 'unknown', reason: 'error-or-aborted-usage' });
  });

  it('invalidates an old measured baseline after model change / compaction / rebuild', () => {
    const occupancy = known(
      estimate({
        baselineInvalidated: true,
        lastCompletedRequest: { inputTokens: 80_000, outputTokens: 10_000, totalTokens: 90_000 },
        observedContext: { systemPromptTokens: 400, messageTokens: 1_600 },
      }),
    );
    expect(occupancy.tokensUsed).toBe(2_000);
    expect(occupancy.quality).toBe('estimated');
    expect(occupancy.tokensUsed).not.toBe(90_000);
  });

  it('uses chars/4 for trailing estimates', () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(5)).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { mapPiAutoRetryEvent } from './model-retry-event-map.js';

describe('mapPiAutoRetryEvent', () => {
  it('maps a delayed retry start as waiting', () => {
    expect(
      mapPiAutoRetryEvent({
        type: 'auto_retry_start',
        attempt: 2,
        maxRetries: 3,
        delayMs: 400,
      }),
    ).toEqual([
      {
        type: 'model/retry',
        phase: 'waiting',
        attempt: 2,
        maxAttempts: 3,
        delayMs: 400,
      },
    ]);
  });

  it('maps an immediate retry start as attempting', () => {
    expect(mapPiAutoRetryEvent({ type: 'auto_retry_start', attempt: 1 })).toEqual([
      { type: 'model/retry', phase: 'attempting', attempt: 1 },
    ]);
  });

  it('maps retry end as finished without terminalizing', () => {
    expect(mapPiAutoRetryEvent({ type: 'auto_retry_end', attempt: 2, success: true })).toEqual([
      { type: 'model/retry', phase: 'finished', attempt: 2 },
    ]);
  });
});

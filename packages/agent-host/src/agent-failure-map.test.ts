import { describe, expect, it } from 'vitest';
import { mapAssistantStopReasonFailure } from './agent-failure-map.js';

describe('mapAssistantStopReasonFailure', () => {
  it('does not emit error for an aborted stop, even when error text is present', () => {
    expect(
      mapAssistantStopReasonFailure(
        {
          role: 'assistant',
          stopReason: 'aborted',
          errorMessage: 'This operation was aborted',
        },
        { type: 'message_end' },
      ),
    ).toBeUndefined();
  });

  it('still maps a real provider error stop', () => {
    const event = mapAssistantStopReasonFailure(
      {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '401 unauthorized',
      },
      { type: 'message_end' },
    );
    expect(event).toMatchObject({
      type: 'error',
      message: '401 unauthorized',
    });
  });
});

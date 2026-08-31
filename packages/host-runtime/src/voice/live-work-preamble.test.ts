import { describe, expect, it } from 'vitest';
import { forgetLiveWorkPreamble, shouldInjectLiveWorkPreamble } from './live-work-preamble.js';

describe('shouldInjectLiveWorkPreamble', () => {
  it('is true once per call id', () => {
    const callId = `call-${Date.now()}-${Math.random()}`;
    expect(shouldInjectLiveWorkPreamble(callId)).toBe(true);
    expect(shouldInjectLiveWorkPreamble(callId)).toBe(false);
    forgetLiveWorkPreamble(callId);
    expect(shouldInjectLiveWorkPreamble(callId)).toBe(true);
    forgetLiveWorkPreamble(callId);
  });
});

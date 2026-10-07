import { describe, expect, it } from 'vitest';
import { parseLiveSystemControl } from './live-system-activity.js';

describe('system Live controls', () => {
  it('accepts the supported action and rejects malformed or unbounded identifiers', () => {
    expect(parseLiveSystemControl({ callId: 'call-1', action: 'end', token: 'private' }))
      .toEqual({ callId: 'call-1', action: 'end' });
    for (const value of [null, {}, { callId: '', action: 'end' },
      { callId: 'x'.repeat(257), action: 'end' }, { callId: 'c', action: 'prompt' }]) {
      expect(parseLiveSystemControl(value)).toBeNull();
    }
  });
});

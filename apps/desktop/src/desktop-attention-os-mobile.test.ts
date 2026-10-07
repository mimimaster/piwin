import { describe, expect, it } from 'vitest';
import { readNotificationActivation } from './desktop-attention-os-mobile.js';

describe('readNotificationActivation', () => {
  it('reads the session a tapped notification points at', () => {
    expect(
      readNotificationActivation({
        title: 'Done',
        extra: { sessionId: 'session-1', attentionKey: 'run:42', identifier: 'n-1' },
      }),
    ).toEqual({ sessionId: 'session-1', attentionKey: 'run:42' });
  });

  it('ignores notifications that carry no session', () => {
    expect(readNotificationActivation(null)).toBeNull();
    expect(readNotificationActivation({ title: 'Other app' })).toBeNull();
    expect(readNotificationActivation({ extra: [] })).toBeNull();
    expect(readNotificationActivation({ extra: { sessionId: '' } })).toBeNull();
  });

  it('still opens the session when the attention key is missing', () => {
    expect(readNotificationActivation({ extra: { sessionId: 'session-2' } })).toEqual({
      sessionId: 'session-2',
      attentionKey: '',
    });
  });
});

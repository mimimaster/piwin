import { describe, expect, it } from 'vitest';
import { LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import { normalizeSubscriptions } from './host-client-helpers.js';

describe('normalizeSubscriptions', () => {
  it('keeps eight unique visible Conversation sessions and drops the ninth', () => {
    const sessionIds = Array.from({ length: 9 }, (_, index) => `session-${index + 1}`);
    expect(normalizeSubscriptions({ sessionIds })?.sessionIds).toEqual(
      sessionIds.slice(0, LIVE_SUBSCRIPTION_MAX_SESSION_IDS),
    );
  });

  it('drops duplicates and invalid ids before applying the ceiling', () => {
    expect(
      normalizeSubscriptions({ sessionIds: ['', 'session-a', 'session-a', 'session-b'] }),
    ).toEqual({ sessionIds: ['session-a', 'session-b'] });
  });
});

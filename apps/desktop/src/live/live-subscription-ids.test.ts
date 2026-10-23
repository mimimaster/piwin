import { describe, expect, it } from 'vitest';
import { LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import { mergeLiveSubscriptionIds } from './live-subscription-ids.js';

describe('mergeLiveSubscriptionIds', () => {
  it('keeps visible sessions first, adds side chats, dedupes', () => {
    expect(mergeLiveSubscriptionIds(['main', 'pane'], ['side', 'main'])).toEqual([
      'main',
      'pane',
      'side',
    ]);
  });

  it('never exceeds the Host per-client limit, dropping side chats last', () => {
    const visible = Array.from({ length: LIVE_SUBSCRIPTION_MAX_SESSION_IDS }, (_, i) => `v${i}`);
    const merged = mergeLiveSubscriptionIds(visible, ['side']);
    expect(merged).toHaveLength(LIVE_SUBSCRIPTION_MAX_SESSION_IDS);
    expect(merged).not.toContain('side');
  });
});

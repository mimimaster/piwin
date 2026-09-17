import { describe, expect, it } from 'vitest';
import {
  ATTENTION_OPT_IN_COOLDOWN_MS,
  shouldShowAttentionOptIn,
} from './attention-opt-in-policy';

const NOW = 1_800_000_000_000;

describe('AN-T48 shouldShowAttentionOptIn', () => {
  it('shows only when authorization is not-determined, a message was sent, and dismiss is stale', () => {
    expect(
      shouldShowAttentionOptIn({
        authorization: 'not-determined',
        hasSentThisLaunch: true,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      shouldShowAttentionOptIn({
        authorization: 'not-determined',
        hasSentThisLaunch: true,
        dismissedAt: NOW - ATTENTION_OPT_IN_COOLDOWN_MS,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      shouldShowAttentionOptIn({
        authorization: 'not-determined',
        hasSentThisLaunch: true,
        dismissedAt: NOW - ATTENTION_OPT_IN_COOLDOWN_MS - 1,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('hides when authorization is not not-determined', () => {
    for (const authorization of ['granted', 'denied', 'unsupported'] as const) {
      expect(
        shouldShowAttentionOptIn({
          authorization,
          hasSentThisLaunch: true,
          dismissedAt: null,
          now: NOW,
        }),
      ).toBe(false);
    }
  });

  it('hides when this launch has not sent a message', () => {
    expect(
      shouldShowAttentionOptIn({
        authorization: 'not-determined',
        hasSentThisLaunch: false,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('hides when dismissed within 7 days', () => {
    expect(
      shouldShowAttentionOptIn({
        authorization: 'not-determined',
        hasSentThisLaunch: true,
        dismissedAt: NOW - ATTENTION_OPT_IN_COOLDOWN_MS + 1,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      shouldShowAttentionOptIn({
        authorization: 'not-determined',
        hasSentThisLaunch: true,
        dismissedAt: NOW,
        now: NOW,
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { shouldRestoreLiveComposer, sendOwnerLockKey, acquireSendOwnerLock, releaseSendOwnerLock } from './composer-send-owner.js';

describe('shouldRestoreLiveComposer', () => {
  it('restores when still on the sending session and the composer is empty', () => {
    expect(
      shouldRestoreLiveComposer({
        ownerSessionId: 'session-a',
        liveSessionId: 'session-a',
        liveComposer: '',
        restoreText: 'from A',
      }),
    ).toBe(true);
  });

  it('restores a just-created session while the view is still in draft mode', () => {
    expect(
      shouldRestoreLiveComposer({
        ownerSessionId: 'session-created-on-send',
        liveSessionId: null,
        liveComposer: '',
        restoreText: 'keep this unsent prompt',
      }),
    ).toBe(true);
  });

  it('does not restore into a different selected session', () => {
    expect(
      shouldRestoreLiveComposer({
        ownerSessionId: 'session-a',
        liveSessionId: 'session-b',
        liveComposer: 'typed in B',
        restoreText: 'from A',
      }),
    ).toBe(false);
  });

  it('keeps text typed on the same owner after send', () => {
    expect(
      shouldRestoreLiveComposer({
        ownerSessionId: 'session-a',
        liveSessionId: 'session-a',
        liveComposer: 'newer note',
        restoreText: 'from A',
      }),
    ).toBe(false);
  });

  it('locks the same owner twice and allows a different owner', () => {
    const locks = new Set<string>();
    const keyA = sendOwnerLockKey('session-a', null);
    const keyB = sendOwnerLockKey('session-b', null);
    expect(acquireSendOwnerLock(locks, keyA)).toBe(true);
    expect(acquireSendOwnerLock(locks, keyA)).toBe(false);
    expect(acquireSendOwnerLock(locks, keyB)).toBe(true);
    releaseSendOwnerLock(locks, keyA);
    expect(acquireSendOwnerLock(locks, keyA)).toBe(true);
  });
});

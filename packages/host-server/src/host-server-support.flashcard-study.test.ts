import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { isSafeRemoteCommand } from './host-server-support.js';

describe('isSafeRemoteCommand flashcards/study', () => {
  it('accepts a parsed catalog command', () => {
    expect(isSafeRemoteCommand({ type: 'flashcards/study/catalog', limit: 20 })).toBe(true);
  });

  it('rejects path-like round ids', () => {
    expect(
      isSafeRemoteCommand({
        type: 'flashcards/study/get',
        roundId: '../etc/passwd',
      } as HostCommand),
    ).toBe(false);
    expect(
      isSafeRemoteCommand({
        type: 'flashcards/study/get',
        roundId: '/Users/secret/round',
      } as HostCommand),
    ).toBe(false);
  });

  it('rejects illegal mode-scope start', () => {
    expect(
      isSafeRemoteCommand({
        type: 'flashcards/study/start',
        mode: 'sequence',
        scope: { kind: 'all' },
        resumeExisting: true,
      } as HostCommand),
    ).toBe(false);
  });

  it('accepts a scheduled rate payload', () => {
    expect(
      isSafeRemoteCommand({
        type: 'flashcards/study/rate',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 0,
        entryId: 'entry-1',
        contentVersion: 'abc',
        rating: 'good',
        expectedReviewStateRevision: 0,
      }),
    ).toBe(true);
  });
});

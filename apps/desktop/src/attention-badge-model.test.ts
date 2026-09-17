import { describe, expect, it } from 'vitest';
import { formatDockBadge, selectAttentionSessionIds } from './attention-badge-model';

describe('selectAttentionSessionIds', () => {
  it('counts a session once across complete and permission and includes the question session (AN-T33)', () => {
    expect(
      selectAttentionSessionIds({
        completedAttentionSessionIds: { 'sess-b': true, 'sess-a': true },
        failedAttentionSessionIds: { 'sess-c': true },
        permissionQueue: [{ sessionId: 'sess-a' }, { sessionId: 'sess-d' }],
        questionSessionId: 'sess-q',
      }),
    ).toEqual(['sess-a', 'sess-b', 'sess-c', 'sess-d', 'sess-q']);
  });

  it('omits a null question session and sorts unique ids', () => {
    expect(
      selectAttentionSessionIds({
        completedAttentionSessionIds: {},
        failedAttentionSessionIds: { zed: true },
        permissionQueue: [{ sessionId: 'alpha' }, { sessionId: 'zed' }],
        questionSessionId: null,
      }),
    ).toEqual(['alpha', 'zed']);
  });
});

describe('formatDockBadge', () => {
  it('maps 0 / 1 / 99 / 100 to clear, count, count, and 99+ (AN-T34)', () => {
    expect(formatDockBadge(0)).toEqual({ kind: 'clear' });
    expect(formatDockBadge(1)).toEqual({ kind: 'count', value: 1 });
    expect(formatDockBadge(99)).toEqual({ kind: 'count', value: 99 });
    expect(formatDockBadge(100)).toEqual({ kind: 'label', value: '99+' });
  });

  it('never throws on non-positive or oversized counts', () => {
    expect(formatDockBadge(-1)).toEqual({ kind: 'clear' });
    expect(formatDockBadge(101)).toEqual({ kind: 'label', value: '99+' });
  });
});

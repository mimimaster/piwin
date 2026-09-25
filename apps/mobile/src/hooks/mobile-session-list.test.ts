import { describe, expect, it } from 'vitest';
import type { RemoteSessionSummary } from '@piwin/contracts';
import { applySessionNamePush, sessionListNeedsRefresh } from './mobile-session-list.js';

const sessions: RemoteSessionSummary[] = [
  { sessionId: 's1', name: '旧名', scope: 'general' },
  { sessionId: 's2', name: '别的', scope: 'general' },
];

describe('session list push handling', () => {
  it('patches a Host rename in place', () => {
    const next = applySessionNamePush(sessions, {
      type: 'session/name-updated',
      sessionId: 's1',
      name: '新名',
      nameSource: 'llm',
    });
    expect(next?.map((session) => session.name)).toEqual(['新名', '别的']);
  });

  it('ignores renames for sessions not in the list or unchanged', () => {
    expect(
      applySessionNamePush(sessions, { type: 'session/name-updated', sessionId: 's9', name: 'x', nameSource: 'user' }),
    ).toBeUndefined();
    expect(
      applySessionNamePush(sessions, { type: 'session/name-updated', sessionId: 's1', name: '旧名', nameSource: 'user' }),
    ).toBeUndefined();
  });

  it('re-reads the list for structural index changes only', () => {
    expect(sessionListNeedsRefresh({ type: 'session/index-updated', op: 'archived', sessionId: 's1' })).toBe(true);
    expect(sessionListNeedsRefresh({ type: 'host/log', level: 'info', message: 'x' })).toBe(false);
  });
});

describe('session list window', () => {
  it('records Host totals and widens the next request after load more', async () => {
    const { createSessionListSync, mobileSessionListCommand, readSessionListPage } = await import(
      './mobile-session-list.js'
    );
    readSessionListPage({
      type: 'response',
      command: 'session/list',
      success: true,
      data: { sessions: [], totalCount: 130, truncated: true },
    });
    const before = mobileSessionListCommand().maxItems;
    const requested: number[] = [];
    const client = {
      request: async (command: { maxItems?: number }) => {
        requested.push(command.maxItems ?? 0);
        return { type: 'response', command: 'session/list', success: true, data: { sessions: [], totalCount: 130, truncated: false } };
      },
    };
    let applied = 0;
    const sync = createSessionListSync(() => {
      applied += 1;
    });
    await sync.loadMore(client as never);
    expect(requested).toEqual([before + 80]);
    expect(mobileSessionListCommand().maxItems).toBe(before + 80);
    expect(applied).toBe(1);
  });
});

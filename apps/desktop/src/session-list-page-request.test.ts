import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, SessionListPageQuery } from '@piwin/contracts';
import { requestSessionListPage } from './session-list-page-request';

const query: SessionListPageQuery = {
  scope: { kind: 'general' },
  lifecycle: 'active',
  order: 'updated',
  limit: 12,
  cursor: 'stale-cursor',
};

describe('requestSessionListPage', () => {
  it('restarts a stale cursor exactly once at page zero', async () => {
    type PageCommand = Extract<HostCommand, { type: 'session/list-page' }>;
    const commands: PageCommand[] = [];
    const responses: HostResponse[] = [
      {
        type: 'response',
        command: 'session/list-page',
        success: true,
        data: { status: 'stale-cursor', currentRevision: 'next' },
      },
      {
        type: 'response',
        command: 'session/list-page',
        success: true,
        data: {
          status: 'page',
          sessions: [],
          page: { revision: 'next', pageIndex: 0, pageCount: 0, totalCount: 0 },
        },
      },
    ];
    const request = vi.fn(async (command: PageCommand): Promise<HostResponse> => {
      commands.push(command);
      const response = responses.shift();
      if (response === undefined) throw new Error('unexpected request');
      return response;
    });

    const result = await requestSessionListPage(request, query);

    expect(result.success).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(commands[0]?.query.cursor).toBe('stale-cursor');
    expect(commands[1]?.query.cursor).toBeUndefined();
  });

  it('does not loop when the cursor remains stale', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'session/list-page',
      success: true,
      data: { status: 'stale-cursor', currentRevision: 'next' },
    }));

    const result = await requestSessionListPage(request, query);

    expect(result).toEqual({
      success: false,
      error: 'Session list page remained stale after one restart',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

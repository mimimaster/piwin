import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, SessionTranscriptPageQuery } from '@piwin/contracts';
import { requestSessionTranscriptPage } from './session-transcript-page-request';

const query: SessionTranscriptPageQuery = {
  sessionId: 'session-1',
  limit: 16,
  maximumBytes: 256 * 1024,
  beforeCursor: 'stale-before',
};

describe('requestSessionTranscriptPage', () => {
  it('restarts a stale older cursor exactly once at the tail', async () => {
    type PageCommand = Extract<HostCommand, { type: 'session/transcript-page' }>;
    const commands: PageCommand[] = [];
    const responses: HostResponse[] = [
      {
        type: 'response',
        command: 'session/transcript-page',
        success: true,
        data: { status: 'stale-cursor', currentRevision: 'next' },
      },
      {
        type: 'response',
        command: 'session/transcript-page',
        success: true,
        data: {
          status: 'page',
          messages: [],
          page: {
            revision: 'next',
            totalCount: 0,
            startIndex: 0,
            endIndex: 0,
            messageBytes: 2,
          },
        },
      },
    ];
    const request = vi.fn(async (command: PageCommand): Promise<HostResponse> => {
      commands.push(command);
      const response = responses.shift();
      if (response === undefined) throw new Error('unexpected request');
      return response;
    });

    const result = await requestSessionTranscriptPage(request, query);

    expect(result.success).toBe(true);
    expect(result.success ? result.restartedAtTail : false).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(commands[0]?.query.beforeCursor).toBe('stale-before');
    expect(commands[1]?.query.beforeCursor).toBeUndefined();
  });

  it('does not loop when the tail remains stale', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'session/transcript-page',
      success: true,
      data: { status: 'stale-cursor', currentRevision: 'next' },
    }));

    expect(await requestSessionTranscriptPage(request, query)).toEqual({
      success: false,
      error: 'Transcript page remained stale after one tail restart',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

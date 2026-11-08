import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_TRANSCRIPT_PAGE_MAX_LOCATE_IDS,
  type HostCommand,
  type HostResponse,
} from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import { requestSessionRecoveryTranscript } from './request-session-recovery-transcript.js';

const page = {
  revision: 'r1',
  totalCount: 0,
  startIndex: 0,
  endIndex: 0,
  messageBytes: 2,
  messagePositions: [],
};

describe('requestSessionRecoveryTranscript', () => {
  it('bounds location work while retaining the query of an unusually long live turn', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => ({
      type: 'response',
      command: command.type,
      success: true,
      data: { status: 'page', messages: [], page },
    }));
    const host = { request, supportsCommand: () => true } as unknown as HostClient;
    const residentMessages = [
      { id: 'only-query', role: 'user' as const },
      ...Array.from({ length: 200 }, (_, index) => ({
        id: `a-${index}`,
        role: 'assistant' as const,
      })),
    ];
    expect(await requestSessionRecoveryTranscript(host, 's1', residentMessages)).toEqual({
      messages: [],
      transcriptPage: page,
    });
    const command = request.mock.calls[0]?.[0];
    if (command?.type !== 'session/transcript-page') throw new Error('Expected page request');
    expect(command.query.locateMessageIds).toHaveLength(SESSION_TRANSCRIPT_PAGE_MAX_LOCATE_IDS);
    expect(command.query.locateMessageIds?.[0]).toBe('only-query');
    expect(command.query.locateMessageIds?.at(-1)).toBe('a-199');
  });

  it('keeps the legacy messages bridge when the Host does not support pages', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => ({
      type: 'response',
      command: command.type,
      success: true,
      data: { messages: [] },
    }));
    const host = { request, supportsCommand: () => false } as unknown as HostClient;
    expect(await requestSessionRecoveryTranscript(host, 's1', [])).toEqual({ messages: [] });
    expect(request).toHaveBeenCalledExactlyOnceWith({ type: 'session/messages', sessionId: 's1' });
  });

  it('does not replace the current transcript when recovery fails', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => ({
      type: 'response',
      command: command.type,
      success: false,
      error: 'Host unavailable',
    }));
    const host = { request, supportsCommand: () => true } as unknown as HostClient;
    expect(await requestSessionRecoveryTranscript(host, 's1', [])).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { copySessionTranscript } from './copy-session-transcript';

describe('copySessionTranscript', () => {
  it('writes markdown from session/export destination=content', async () => {
    const request = vi.fn().mockResolvedValue({
      type: 'response',
      command: 'session/export',
      success: true,
      data: { content: '### User\n\nhello\n' },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);

    const result = await copySessionTranscript({
      hostClient: { request },
      sessionId: 'sess-1',
      writeText,
    });

    expect(result).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith({
      type: 'session/export',
      sessionId: 'sess-1',
      format: 'md',
      destination: 'content',
    });
    expect(writeText).toHaveBeenCalledWith('### User\n\nhello\n');
  });

  it('returns the Host error when export fails', async () => {
    const result = await copySessionTranscript({
      hostClient: {
        request: async () => ({
          type: 'response',
          command: 'session/export',
          success: false,
          error: 'Unknown session: missing',
        }),
      },
      sessionId: 'missing',
      writeText: async () => {
        throw new Error('should not write');
      },
    });
    expect(result).toEqual({ ok: false, message: 'Unknown session: missing' });
  });

  it('fails closed when the Host omits content', async () => {
    const result = await copySessionTranscript({
      hostClient: {
        request: async () => ({
          type: 'response',
          command: 'session/export',
          success: true,
          data: { path: '/tmp/export.md', byteLength: 12 },
        }),
      },
      sessionId: 'sess-1',
      writeText: async () => {
        throw new Error('should not write');
      },
    });
    expect(result.ok).toBe(false);
  });
});

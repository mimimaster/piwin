import { describe, expect, it, vi } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { mergeTranscriptMetadata, scheduleReplyWriterAfterRun } from './reply-writer-live.js';
import type { SessionLiveContext } from './session-live-context.js';

describe('reply writer live hook', () => {
  it('merges rewrite attribution without dropping existing metadata', () => {
    const message = {
      id: 'a1',
      role: 'assistant',
      text: '草稿',
      createdAt: '2026-08-20T00:00:00.000Z',
      status: 'done',
      startedAt: '2026-08-20T00:00:00.000Z',
      endedAt: '2026-08-20T00:00:02.000Z',
    } satisfies SessionTranscriptMessage;
    expect(
      mergeTranscriptMetadata(message, {
        language: 'zh-CN',
        sourceText: '草稿',
        model: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4.1' },
      }),
    ).toEqual({
      startedAt: '2026-08-20T00:00:00.000Z',
      endedAt: '2026-08-20T00:00:02.000Z',
      replyWriter: {
        language: 'zh-CN',
        sourceText: '草稿',
        model: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4.1' },
      },
    });
  });

  it('no-ops when reply writer is disabled', async () => {
    const lastMessageByRole = vi.fn();
    const context = {
      piwinRoot: '/tmp/piwin-reply-writer-disabled',
      loadConfig: async () => ({
        hostMode: 'sdk',
        providers: [],
        media: { maxPasteBytes: 1, allowedMimeTypes: [] },
        artifact: { enabled: true },
      }),
      getTranscriptStore: async () => ({ lastMessageByRole }),
      push: vi.fn(),
    } as unknown as SessionLiveContext;
    await scheduleReplyWriterAfterRun(context, { sessionId: 's1', runId: 'r1' });
    expect(lastMessageByRole).not.toHaveBeenCalled();
  });
});

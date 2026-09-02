import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { attachOrphansToTranscriptMessages } from './bind-orphan-generated-media.js';

function message(
  partial: Partial<SessionTranscriptMessage> &
    Pick<SessionTranscriptMessage, 'id' | 'role' | 'createdAt'>,
): SessionTranscriptMessage {
  return {
    text: '',
    status: 'done',
    runtimeGenerationId: 'gen-1',
    ...partial,
  };
}

describe('attachOrphansToTranscriptMessages', () => {
  it('binds an unreferenced generated image onto the first assistant of that user turn', () => {
    const user = message({
      id: 'u1',
      role: 'user',
      createdAt: '2026-09-01T04:55:05.371Z',
      text: '随便生成张图片',
    });
    const thinking = message({
      id: 'a1',
      role: 'assistant',
      createdAt: '2026-09-01T04:55:09.184Z',
      thinking: 'check the image API',
    });
    const caption = message({
      id: 'a2',
      role: 'assistant',
      createdAt: '2026-09-01T04:55:21.150Z',
      text: '随手出了一张：黄昏乡间小路。',
    });
    const filled = attachOrphansToTranscriptMessages([user, thinking, caption], [
      {
        assetId: '08480cbd-0412-4648-8dbb-d8586fe55af8',
        createdAt: '2026-09-01T04:55:17.904Z',
        mimeType: 'image/jpeg',
        byteSize: 409561,
        absolutePath:
          '/Users/yorickjue/.piwin-test/media/session-x/08480cbd-0412-4648-8dbb-d8586fe55af8.jpg',
        kind: 'image',
      },
    ]);

    expect(filled[1]?.attachments).toEqual([
      {
        id: '08480cbd-0412-4648-8dbb-d8586fe55af8',
        kind: 'media',
        path: '/Users/yorickjue/.piwin-test/media/session-x/08480cbd-0412-4648-8dbb-d8586fe55af8.jpg',
        mimeType: 'image/jpeg',
        byteSize: 409561,
        source: 'generated',
        contentKind: 'image',
      },
    ]);
    expect(filled[2]?.attachments).toBeUndefined();
  });

  it('does not duplicate an asset already referenced on a transcript row', () => {
    const assistant = message({
      id: 'a1',
      role: 'assistant',
      createdAt: '2026-09-01T04:55:09.184Z',
      attachments: [
        {
          id: '08480cbd-0412-4648-8dbb-d8586fe55af8',
          kind: 'media',
          path: '/tmp/08480cbd-0412-4648-8dbb-d8586fe55af8.jpg',
          mimeType: 'image/jpeg',
          byteSize: 12,
          source: 'generated',
        },
      ],
    });
    const filled = attachOrphansToTranscriptMessages([assistant], [
      {
        assetId: '08480cbd-0412-4648-8dbb-d8586fe55af8',
        createdAt: '2026-09-01T04:55:17.904Z',
        mimeType: 'image/jpeg',
        byteSize: 409561,
        absolutePath: '/tmp/08480cbd-0412-4648-8dbb-d8586fe55af8.jpg',
        kind: 'image',
      },
    ]);
    expect(filled[0]?.attachments).toHaveLength(1);
  });
});

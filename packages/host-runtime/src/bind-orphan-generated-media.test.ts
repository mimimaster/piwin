import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attachOrphansToTranscriptMessages,
  detachUserOwnedMediaFromAssistants,
  listSessionGeneratedMedia,
} from './bind-orphan-generated-media.js';

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

describe('attachOrphansToTranscriptMessages page tail', () => {
  it('does not dump an older unreferenced asset onto the latest assistant', () => {
    const recentUser = message({
      id: 'u-recent',
      role: 'user',
      createdAt: '2026-09-10T18:21:40.931Z',
      text: '能不能直接验证session呢',
    });
    const recentAssistant = message({
      id: 'a-recent',
      role: 'assistant',
      createdAt: '2026-09-10T18:22:40.759Z',
      text: 'Session 本身：有效',
    });
    const filled = attachOrphansToTranscriptMessages([recentUser, recentAssistant], [
      {
        assetId: 'c4b1875b-c761-4847-9778-753f5f0daa0e',
        createdAt: '2026-09-07T15:13:48.876Z',
        mimeType: 'image/jpeg',
        byteSize: 55106,
        absolutePath:
          '/Users/yorickjue/.piwin/media/session-x/c4b1875b-c761-4847-9778-753f5f0daa0e.jpg',
        kind: 'image',
      },
    ]);

    expect(filled[1]?.attachments).toBeUndefined();
  });
});

describe('detachUserOwnedMediaFromAssistants', () => {
  it('strips paste vault ids that were rewritten onto an assistant row', () => {
    const assistant = message({
      id: 'a-latest',
      role: 'assistant',
      createdAt: '2026-09-10T18:22:40.759Z',
      attachments: [
        {
          id: 'c4b1875b-c761-4847-9778-753f5f0daa0e',
          kind: 'media',
          path: '/tmp/c4b1875b-c761-4847-9778-753f5f0daa0e.jpg',
          mimeType: 'image/jpeg',
          byteSize: 55106,
          source: 'generated',
          contentKind: 'image',
        },
      ],
    });
    const cleaned = detachUserOwnedMediaFromAssistants(
      [assistant],
      new Set(['c4b1875b-c761-4847-9778-753f5f0daa0e']),
    );
    expect(cleaned[0]?.attachments).toBeUndefined();
  });
});

describe('listSessionGeneratedMedia', () => {
  it('ignores paste screenshots and only returns generated vault files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-orphan-media-'));
    const pasteId = 'paste-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const generatedId = 'gen-bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    await writeFile(join(dir, `${pasteId}.jpg`), 'paste-bytes');
    await writeFile(
      join(dir, `${pasteId}.json`),
      `${JSON.stringify({
        source: 'paste',
        kind: 'image',
        createdAt: '2026-09-07T15:13:48.876Z',
        name: 'Screenshot 2026-09-07 at 23-13-37.png',
      })}\n`,
    );
    await writeFile(join(dir, `${generatedId}.png`), 'generated-bytes');
    await writeFile(
      join(dir, `${generatedId}.json`),
      `${JSON.stringify({
        source: 'generated',
        kind: 'image',
        createdAt: '2026-09-10T04:55:17.904Z',
        prompt: 'foggy pier',
      })}\n`,
    );

    const generated = await listSessionGeneratedMedia(dir);
    expect(generated).toEqual([
      expect.objectContaining({
        assetId: generatedId,
        mimeType: 'image/png',
        kind: 'image',
      }),
    ]);
  });
});

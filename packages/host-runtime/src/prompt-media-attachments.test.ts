import { describe, expect, it } from 'vitest';
import type { MediaAttachmentRef } from '@piwin/contracts';
import {
  isNativeImageAttachment,
  isTextualAttachment,
  resolveMediaContentKind,
  stripMediaAttachments,
} from './prompt-media-attachments.js';

function media(
  overrides: Partial<MediaAttachmentRef> & Pick<MediaAttachmentRef, 'path' | 'mimeType'>,
): MediaAttachmentRef {
  const attachment: MediaAttachmentRef = {
    id: 'a1',
    kind: 'media',
    byteSize: 32,
    source: 'file-picker',
    ...overrides,
  };
  return attachment;
}

describe('resolveMediaContentKind', () => {
  it('treats markdown as text even when the OS stamps octet-stream', () => {
    const attachment = media({
      path: '/media/candy-game.md',
      mimeType: 'application/octet-stream',
      name: 'candy-game.md',
    });
    expect(resolveMediaContentKind(attachment)).toBe('text');
    expect(isTextualAttachment(attachment)).toBe(true);
    expect(isNativeImageAttachment(attachment)).toBe(false);
  });

  it('keeps real images as native image parts', () => {
    const attachment = media({
      path: '/media/shot.png',
      mimeType: 'image/png',
      contentKind: 'image',
    });
    expect(isNativeImageAttachment(attachment)).toBe(true);
    expect(isTextualAttachment(attachment)).toBe(false);
  });
});

describe('stripMediaAttachments', () => {
  it('drops leftover media so a later image loader cannot encode a file', () => {
    const prepared = stripMediaAttachments(
      {
        text: 'solve this',
        attachments: [
          media({
            path: '/media/candy-game.md',
            mimeType: 'text/markdown',
            name: 'candy-game.md',
            contentKind: 'text',
          }),
        ],
      },
      '[attached file: candy-game.md]\n# Candy',
      [],
    );
    expect(prepared.attachments).toBeUndefined();
    expect(prepared.text).toContain('Candy');
  });
});

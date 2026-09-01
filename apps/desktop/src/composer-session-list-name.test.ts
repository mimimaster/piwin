import { describe, expect, it } from 'vitest';
import { composerSessionListName } from './composer-session-list-name';
import type { PendingComposerAttachment } from './media-utils.js';

function mediaChip(name: string): PendingComposerAttachment {
  return {
    localId: name,
    previewUrl: '',
    attachment: {
      id: name,
      kind: 'media',
      path: `/tmp/${name}`,
      mimeType: 'image/png',
      name,
      byteSize: 12,
      source: 'file-picker',
    },
  };
}

describe('composerSessionListName', () => {
  it('prefers text, then attachment name, then Conversation', () => {
    expect(composerSessionListName('Fix auth', [])).toBe('Fix auth');
    expect(composerSessionListName('', [mediaChip('shot.png')])).toBe('shot.png');
    expect(composerSessionListName('', [])).toBe('Conversation');
  });
});

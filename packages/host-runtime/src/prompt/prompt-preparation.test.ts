import { describe, expect, it } from 'vitest';
import type { PromptAttachment } from '@piwin/contracts';
import {
  decideMediaRouting,
  extractMediaAttachments,
  formatVisionDescriptionInjection,
  pathInjectMediaAttachment,
} from './prompt-preparation.js';

function mediaAttachment(
  path: string,
  mimeType = 'image/png',
): Extract<PromptAttachment, { kind: 'media' }> {
  return {
    id: `id-${path}`,
    kind: 'media',
    path,
    mimeType,
    byteSize: 1024,
    source: 'paste',
  };
}

describe('decideMediaRouting', () => {
  it('native text has no absolute path or base64 (media attachments handled separately)', () => {
    const decision = decideMediaRouting({
      text: 'describe this',
      attachments: [mediaAttachment('/abs/pic.png')],
      primarySupportsImage: true,
      allowPathFallback: false,
    });
    expect(decision.mode).toBe('native');
    if (decision.mode === 'native') {
      expect(decision.images).toHaveLength(1);
      expect(decision.images[0]?.mimeType).toBe('image/png');
    }
  });

  it('native images are present for vision models', () => {
    const decision = decideMediaRouting({
      text: 'look',
      attachments: [mediaAttachment('/a/1.png'), mediaAttachment('/a/2.jpg', 'image/jpeg')],
      primarySupportsImage: true,
      allowPathFallback: false,
    });
    expect(decision.mode).toBe('native');
    if (decision.mode === 'native') {
      expect(decision.images.map((item) => item.mimeType)).toEqual(['image/png', 'image/jpeg']);
    }
  });

  it('path fallback is opt-in and injects paths only when allowed', () => {
    const blocked = decideMediaRouting({
      text: 'hi',
      attachments: [mediaAttachment('/x/y.png')],
      primarySupportsImage: false,
      allowPathFallback: false,
    });
    expect(blocked.mode).toBe('error');

    const fallback = decideMediaRouting({
      text: 'hi',
      attachments: [mediaAttachment('/x/y.png')],
      primarySupportsImage: false,
      allowPathFallback: true,
    });
    expect(fallback.mode).toBe('path-fallback');
    if (fallback.mode === 'path-fallback') {
      expect(fallback.injections[0]?.path).toBe('/x/y.png');
    }
  });

  it('empty attachments short-circuit to native with no images', () => {
    const decision = decideMediaRouting({
      text: 'plain',
      attachments: [],
      primarySupportsImage: false,
      allowPathFallback: false,
    });
    expect(decision).toEqual({ mode: 'native', images: [] });
  });
});

describe('formatVisionDescriptionInjection', () => {
  it('injects a description without requiring path presence in prompt text', () => {
    const injection = formatVisionDescriptionInjection({
      absolutePath: '/abs/pic.png',
      mimeType: 'image/png',
      description: 'a red circle',
    });
    expect(injection).toContain('a red circle');
    expect(injection).toContain('/abs/pic.png');
  });
});

describe('pathInjectMediaAttachment', () => {
  it('produces a stable fallback line', () => {
    expect(pathInjectMediaAttachment(mediaAttachment('/z.png'))).toBe('[attached image: /z.png]');
  });
});

import { describe, expect, it } from 'vitest';
import { EMOJI_ICON_GLYPHS } from './emoji-icon-glyphs.generated.js';
import { EMOJI_ICON_NAMES } from './emoji-icon-map.js';
import { resolveEmojiIcon, segmentEmojiText } from './emoji-icon-text.js';

describe('segmentEmojiText', () => {
  it('replaces mapped emoji and keeps surrounding text', () => {
    expect(segmentEmojiText('🔑 密钥 K')).toEqual([
      { kind: 'icon', emoji: '🔑', icon: 'key' },
      { kind: 'text', text: ' 密钥 K' },
    ]);
  });

  it('folds variation selectors, skin tones and ZWJ sequences', () => {
    expect(resolveEmojiIcon('🕵️')).toBe('spy');
    expect(resolveEmojiIcon('👍🏽')).toBe('thumb-up');
    expect(resolveEmojiIcon('👩‍💻')).toBe('user-code');
  });

  it('keeps unmapped emoji and text-presentation symbols', () => {
    expect(segmentEmojiText('🦄 ok')).toBeNull();
    expect(segmentEmojiText('a ↗ b © c')).toBeNull();
    expect(resolveEmojiIcon('⚠')).toBeNull();
    expect(resolveEmojiIcon('⚠️')).toBe('alert-triangle');
    expect(resolveEmojiIcon('⚠︎')).toBeNull();
  });

  it('every mapped icon has a generated glyph', () => {
    for (const icon of Object.values(EMOJI_ICON_NAMES)) expect(EMOJI_ICON_GLYPHS[icon]).toBeDefined();
  });
});

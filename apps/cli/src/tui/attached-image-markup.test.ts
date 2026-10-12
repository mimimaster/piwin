import { describe, expect, it } from 'vitest';
import { replaceAttachedImageMarkup } from './attached-image-markup.js';

describe('replaceAttachedImageMarkup', () => {
  it('turns the Host model markup into a short marker', () => {
    const text = 'you said: hi\n\n<attached_image path="/root/media/session-1/a1.png" mime="image/png" bytes="10696" />\nend';
    expect(replaceAttachedImageMarkup(text)).toBe('you said: hi\n\n[图片 a1.png]\nend');
  });
  it('hides a tag that is still streaming in', () => {
    expect(replaceAttachedImageMarkup('reply\n<attached_image path="/root/me')).toBe('reply\n');
  });
  it('leaves other text alone', () => {
    expect(replaceAttachedImageMarkup('a <b/> c')).toBe('a <b/> c');
  });
});

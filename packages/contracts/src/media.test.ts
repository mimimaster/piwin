import { describe, expect, it } from 'vitest';
import {
  formatTextModelImageInjection,
  isMediaThumbFileName,
  mediaThumbFileName,
  pickMediaThumbEdge,
} from './media.js';

describe('gallery thumb tiers', () => {
  it('names and detects 256 / 384 sidecars plus the legacy suffix', () => {
    expect(mediaThumbFileName('abc', 256)).toBe('abc.thumb.256.webp');
    expect(mediaThumbFileName('abc', 384)).toBe('abc.thumb.384.webp');
    expect(isMediaThumbFileName('abc.thumb.256.webp')).toBe(true);
    expect(isMediaThumbFileName('abc.thumb.384.webp')).toBe(true);
    expect(isMediaThumbFileName('abc.thumb.webp')).toBe(true);
    expect(isMediaThumbFileName('abc.webp')).toBe(false);
    expect(isMediaThumbFileName('abc.png')).toBe(false);
  });

  it('picks 256 when css×dpr fits, otherwise 384', () => {
    expect(pickMediaThumbEdge(148, 1)).toBe(256);
    expect(pickMediaThumbEdge(148, 2)).toBe(384);
    expect(pickMediaThumbEdge(240, 2)).toBe(384);
  });
});

describe('formatTextModelImageInjection', () => {
  it('formats path mime size and dimensions', () => {
    const text = formatTextModelImageInjection({
      absolutePath: '/Users/me/.piwin/media/s1/a.png',
      mimeType: 'image/png',
      byteSize: 123,
      width: 10,
      height: 20,
    });
    expect(text).toContain('path="/Users/me/.piwin/media/s1/a.png"');
    expect(text).toContain('mime="image/png"');
    expect(text).toContain('bytes="123"');
    expect(text).toContain('dimensions="10x20"');
  });
});

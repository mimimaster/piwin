import { describe, expect, it } from 'vitest';
import { formatTextModelImageInjection } from './media.js';

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

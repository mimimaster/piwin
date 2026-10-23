import { describe, expect, it } from 'vitest';
import { catalogDescription } from './catalog-display-copy.js';

describe('catalogDescription', () => {
  it('keeps English fallbacks in en', () => {
    expect(catalogDescription('imagegen', 'Generate images', 'en')).toBe('Generate images');
  });

  it('uses Chinese copy for bundled catalog ids', () => {
    expect(catalogDescription('imagegen', 'Generate images', 'zh-CN')).toContain('位图');
    expect(catalogDescription('path-guard', 'Block writes', 'zh-CN')).toContain('密钥');
  });

  it('falls back when no Chinese copy exists', () => {
    expect(catalogDescription('my-notes', 'Personal notes', 'zh-CN')).toBe('Personal notes');
  });
});

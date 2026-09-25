import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './workspace-browser.js';

describe('normalizeUrl', () => {
  it('keeps explicit schemes and fills https for bare hosts', () => {
    expect(normalizeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(normalizeUrl(' example.com ')).toBe('https://example.com');
    expect(normalizeUrl('localhost:5173/x')).toBe('http://localhost:5173/x');
  });

  it('refuses free text instead of guessing a search engine', () => {
    expect(normalizeUrl('鹈鹕 图片')).toBeUndefined();
    expect(normalizeUrl('')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './normalize-url';

describe('normalizeUrl', () => {
  it('keeps a full http URL as-is', () => {
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('keeps a full https URL as-is', () => {
    expect(normalizeUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('prefixes a plain localhost with port', () => {
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000');
  });

  it('prefixes a bare port with http://localhost', () => {
    expect(normalizeUrl('3000')).toBe('http://localhost:3000');
  });

  it('prefixes an IPv4 address with port', () => {
    expect(normalizeUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('prefixes a bare domain with https', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });

  it('returns empty for whitespace-only input', () => {
    expect(normalizeUrl('   ')).toBe('');
  });

  it('keeps a file URL as-is so local HTML can stay in the workbench browser', () => {
    expect(normalizeUrl('file:///Users/me/site/index.html')).toBe(
      'file:///Users/me/site/index.html',
    );
  });
});

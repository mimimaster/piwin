import { describe, expect, it } from 'vitest';
import { normalizeLanguage, languageFromPath } from './syntax-highlight';

describe('normalizeLanguage', () => {
  it('maps common aliases to shiki language ids', () => {
    expect(normalizeLanguage('ts')).toBe('typescript');
    expect(normalizeLanguage('JS')).toBe('javascript');
    expect(normalizeLanguage('py')).toBe('python');
    expect(normalizeLanguage('sh')).toBe('bash');
    expect(normalizeLanguage('yml')).toBe('yaml');
    expect(normalizeLanguage('md')).toBe('markdown');
  });

  it('falls back to the lowercased label when no alias matches', () => {
    expect(normalizeLanguage('Rust')).toBe('rust');
  });

  it('treats empty / text / plaintext as typescript fallback', () => {
    expect(normalizeLanguage('')).toBe('typescript');
    expect(normalizeLanguage('text')).toBe('typescript');
    expect(normalizeLanguage('plaintext')).toBe('typescript');
  });
});

describe('languageFromPath', () => {
  it('infers language from a file extension', () => {
    expect(languageFromPath('src/foo.ts')).toBe('typescript');
    expect(languageFromPath('bar.py')).toBe('python');
    expect(languageFromPath('a/b/c/shell.sh')).toBe('bash');
  });

  it('falls back to typescript when there is no extension', () => {
    expect(languageFromPath('Makefile')).toBe('typescript');
  });
});

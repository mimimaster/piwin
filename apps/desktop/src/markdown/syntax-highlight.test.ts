import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import {
  normalizeLanguage,
  languageFromPath,
  tokenKindFromColor,
  TokenSpans,
} from './syntax-highlight';

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

describe('tokenKindFromColor', () => {
  it('maps github-light and github-dark palettes onto Inkstone token roles', () => {
    expect(tokenKindFromColor('#D73A49')).toBe('k');
    expect(tokenKindFromColor('#f97583')).toBe('k');
    expect(tokenKindFromColor('#032F62')).toBe('s');
    expect(tokenKindFromColor('#9ECBFF')).toBe('s');
    expect(tokenKindFromColor('#6A737D')).toBe('c');
    expect(tokenKindFromColor('#6F42C1')).toBe('fx');
    expect(tokenKindFromColor('#B392F0')).toBe('fx');
    expect(tokenKindFromColor('#24292E')).toBeNull();
    expect(tokenKindFromColor(undefined)).toBeNull();
  });
});

describe('TokenSpans', () => {
  it('paints mapped tokens with Inkstone classes instead of github hex', () => {
    const nodes = TokenSpans({
      tokens: [
        { content: 'if', color: '#D73A49', offset: 0 },
        { content: ' ', offset: 2 },
      ],
    });
    const spans = Array.isArray(nodes) ? nodes : [nodes];
    expect(isValidElement(spans[0])).toBe(true);
    expect(isValidElement(spans[1])).toBe(true);
    if (isValidElement<{ className?: string; style?: unknown }>(spans[0])) {
      expect(spans[0].props.className).toBe('md-tok md-tok-k');
      expect(spans[0].props.style).toBeUndefined();
    }
    if (isValidElement<{ className?: string; style?: unknown }>(spans[1])) {
      expect(spans[1].props.className).toBeUndefined();
    }
  });
});

describe('highlightCode', () => {
  it('highlights python and other languages', async () => {
    const { highlightCode } = await import('./syntax-highlight');
    const result = await highlightCode(
      'from transformers import AutoModelForCausalLM\n# comment\nx = "hello"',
      'python',
    );
    expect(result.length).toBe(3);
    const comment = result[1]?.[0];
    expect(tokenKindFromColor(comment?.color)).toBe('c');
    const stringToken = result[2]?.find((token) => token.content.includes('hello'));
    expect(tokenKindFromColor(stringToken?.color)).toBe('s');
  });
});

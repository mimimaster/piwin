import { describe, expect, it } from 'vitest';
import { buildMatchExpression, tokenize, tokenizeForIndex } from './tokenize.js';

describe('tokenize', () => {
  it('segments Chinese into dictionary words', () => {
    const tokens = tokenize('闪卡复习调度算法');
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.join('')).toBe('闪卡复习调度算法');
  });

  it('keeps two-character Chinese words searchable', () => {
    expect(tokenize('复习')).toEqual(['复习']);
  });

  it('lowercases latin words and drops punctuation', () => {
    expect(tokenize('Hello, FTS5 World!')).toEqual(['hello', 'fts5', 'world']);
  });

  it('handles mixed CJK and latin', () => {
    const tokens = tokenize('用sqlite做笔记检索');
    expect(tokens).toContain('sqlite');
    expect(tokens).toContain('笔记');
  });

  it('returns empty for whitespace/punctuation-only input', () => {
    expect(tokenize('  …！!!  ')).toEqual([]);
  });
});

describe('tokenizeForIndex', () => {
  it('space-joins tokens without assuming exact dictionary segmentation', () => {
    const joined = tokenizeForIndex('闪卡复习');
    expect(joined).toContain(' ');
    expect(joined.split(' ').join('')).toBe('闪卡复习');
  });
});

describe('buildMatchExpression', () => {
  it('quotes tokens to neutralize FTS5 operators', () => {
    expect(buildMatchExpression('NOT OR (evil)')).toBe('"not" "or" "evil"');
  });

  it('returns null for empty queries', () => {
    expect(buildMatchExpression('!!!')).toBeNull();
  });

  it('builds AND query from Chinese phrase', () => {
    const expr = buildMatchExpression('复习 算法');
    expect(expr).toBe('"复习" "算法"');
  });
});

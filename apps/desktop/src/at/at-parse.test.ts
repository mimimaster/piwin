import { describe, expect, it } from 'vitest';
import { detectActiveAtToken, replaceActiveAtToken } from './at-parse';

describe('at-parse', () => {
  it('detects @ token under caret', () => {
    const text = 'Hello @src/App.tsx world';
    const token = detectActiveAtToken(text, 14);
    expect(token).toEqual({
      raw: '@src/App.tsx',
      query: 'src/App.tsx',
      startIndex: 6,
      endIndex: 18,
    });
  });

  it('returns null when @ token is not under caret', () => {
    const text = 'Hello world';
    const token = detectActiveAtToken(text, 5);
    expect(token).toBeNull();
  });

  it('replaces active @ token correctly', () => {
    const text = 'Hello @src/App.tsx world';
    const token = detectActiveAtToken(text, 10)!;
    const result = replaceActiveAtToken(text, token, '@src/components/Main.tsx ');
    expect(result).toBe('Hello @src/components/Main.tsx  world');
  });
});

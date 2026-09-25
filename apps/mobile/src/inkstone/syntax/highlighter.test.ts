import { describe, expect, it } from 'vitest';
import { MAX_HIGHLIGHT_CHARS, highlightCode } from './highlighter.js';

describe('highlightCode', () => {
  it('returns one token row per line with paper and ink colours', async () => {
    const lines = await highlightCode('const answer = 42;\nexport { answer };', 'typescript');
    expect(lines).toHaveLength(2);
    const keyword = lines?.[0]?.find((token) => token.content.trim() === 'const');
    expect(keyword?.light).toMatch(/^#/);
    expect(keyword?.dark).toMatch(/^#/);
    expect(lines?.[0]?.map((token) => token.content).join('')).toBe('const answer = 42;');
  }, 20_000);

  it('declines oversized files and unknown grammars instead of guessing', async () => {
    expect(await highlightCode('x'.repeat(MAX_HIGHLIGHT_CHARS + 1), 'typescript')).toBeUndefined();
    expect(await highlightCode('hello', 'not-a-language')).toBeUndefined();
  }, 20_000);
});

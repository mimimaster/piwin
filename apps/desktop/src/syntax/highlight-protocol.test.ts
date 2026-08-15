import { describe, expect, it } from 'vitest';
import type { ThemedToken } from 'shiki';
import {
  decodeCompactToTokenLines,
  encodeTokensToCompact,
  hashSource,
} from './highlight-protocol';

describe('Highlight Worker Protocol', () => {
  it('computes stable 32-bit FNV-1a hash for source code', () => {
    const code = 'const hello = "world";';
    const hash1 = hashSource(code);
    const hash2 = hashSource(code);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(8);

    const hashDiff = hashSource('const hello = "world2";');
    expect(hash1).not.toBe(hashDiff);
  });

  it('encodes and decodes token spans with palette and Uint32Array without loss', () => {
    const code = 'const count = 42;\nconsole.log(count);';
    const rawTokens: ThemedToken[][] = [
      [
        { content: 'const', color: '#ff7b72', offset: 0 },
        { content: ' ', offset: 5 },
        { content: 'count', color: '#79c0ff', offset: 6 },
        { content: ' = ', offset: 11 },
        { content: '42', color: '#79c0ff', offset: 14 },
        { content: ';', offset: 16 },
      ],
      [
        { content: 'console', color: '#ffa657', offset: 0 },
        { content: '.', offset: 7 },
        { content: 'log', color: '#d2a8ff', offset: 8 },
        { content: '(', offset: 11 },
        { content: 'count', color: '#79c0ff', offset: 12 },
        { content: ');', offset: 17 },
      ],
    ];

    const { palette, runs } = encodeTokensToCompact(rawTokens);
    expect(palette.length).toBeGreaterThan(0);
    // 12 tokens * 4 Uint32 words = 48
    expect(runs.length).toBe(12 * 4);

    const decoded = decodeCompactToTokenLines(code, palette, runs);
    expect(decoded.length).toBe(2);
    expect(decoded[0]?.length).toBe(6);
    expect(decoded[0]?.[0]?.content).toBe('const');
    expect(decoded[0]?.[0]?.color).toBe('#ff7b72');
    expect(decoded[1]?.[2]?.content).toBe('log');
    expect(decoded[1]?.[2]?.color).toBe('#d2a8ff');
  });

  it('supports line sliced decoding for viewport rendering', () => {
    const code = 'line 0\nline 1\nline 2\nline 3\nline 4';
    const rawTokens: ThemedToken[][] = [
      [{ content: 'line 0', color: '#111', offset: 0 }],
      [{ content: 'line 1', color: '#222', offset: 0 }],
      [{ content: 'line 2', color: '#333', offset: 0 }],
      [{ content: 'line 3', color: '#444', offset: 0 }],
      [{ content: 'line 4', color: '#555', offset: 0 }],
    ];

    const { palette, runs } = encodeTokensToCompact(rawTokens);
    // Slice only lines 1..3
    const sliced = decodeCompactToTokenLines(code, palette, runs, 1, 3);
    expect(sliced.length).toBe(2);
    expect(sliced[0]?.[0]?.content).toBe('line 1');
    expect(sliced[0]?.[0]?.color).toBe('#222');
    expect(sliced[1]?.[0]?.content).toBe('line 2');
    expect(sliced[1]?.[0]?.color).toBe('#333');
  });
});

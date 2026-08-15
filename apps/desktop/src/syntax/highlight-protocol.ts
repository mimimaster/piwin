/**
 * Shiki Highlight Worker Protocol & Compact Serialization.
 *
 * Transfers syntax highlight data between Worker and UI main thread
 * using a compact palette-indexed flat Uint32Array to minimize GC overhead:
 * Each token span is packed as 4 Uint32 words:
 * [lineIndex, colStart, colEnd, colorIndex]
 */
import type { ThemedToken } from 'shiki';

export type HighlightWorkerRequest = {
  requestId: string;
  sourceHash: string;
  code: string;
  language: string;
  theme: 'github-dark' | 'github-light';
  lineStart?: number;
  lineEnd?: number;
};

export type HighlightWorkerResponse = {
  requestId: string;
  sourceHash: string;
  lineStart: number;
  lineEnd: number;
  palette: string[];
  /** Packed 4-tuple per token: [lineIndex, colStart, colEnd, colorIndex] */
  runs: Uint32Array;
};

export type TokenSpan = {
  content: string;
  color?: string;
  offset: number;
};

export type TokenLine = TokenSpan[];

/**
 * Fast 32-bit FNV-1a hash for checking source identity and detecting stale responses.
 */
export function hashSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Encodes Shiki ThemedToken[][] into a palette + Uint32Array flat buffer.
 */
export function encodeTokensToCompact(
  tokenLines: ThemedToken[][],
  lineOffset = 0,
): { palette: string[]; runs: Uint32Array } {
  const palette: string[] = [];
  const paletteMap = new Map<string, number>();

  function getColorIndex(color: string | undefined): number {
    const key = color ?? '';
    let index = paletteMap.get(key);
    if (index === undefined) {
      index = palette.length;
      palette.push(key);
      paletteMap.set(key, index);
    }
    return index;
  }

  // Count total tokens
  let totalTokens = 0;
  for (const line of tokenLines) {
    totalTokens += line.length;
  }

  const runs = new Uint32Array(totalTokens * 4);
  let runOffset = 0;

  for (let lineIndex = 0; lineIndex < tokenLines.length; lineIndex++) {
    const line = tokenLines[lineIndex] ?? [];
    let col = 0;
    const actualLineIndex = lineIndex + lineOffset;

    for (const token of line) {
      const tokenLength = token.content.length;
      const colStart = col;
      const colEnd = col + tokenLength;
      const colorIndex = getColorIndex(token.color);

      runs[runOffset] = actualLineIndex;
      runs[runOffset + 1] = colStart;
      runs[runOffset + 2] = colEnd;
      runs[runOffset + 3] = colorIndex;

      runOffset += 4;
      col = colEnd;
    }
  }

  return { palette, runs };
}

/**
 * Decodes palette + Uint32Array flat buffer back into TokenLine[] (TokenSpan[]).
 */
export function decodeCompactToTokenLines(
  code: string,
  palette: string[],
  runs: Uint32Array,
  lineStart = 0,
  lineEnd?: number,
): TokenLine[] {
  const lines = code.split('\n');
  const actualEnd = lineEnd !== undefined ? Math.min(lineEnd, lines.length) : lines.length;
  const slicedLines = lines.slice(lineStart, actualEnd);

  const result: TokenLine[] = Array.from({ length: slicedLines.length }, () => []);

  const totalRuns = runs.length / 4;
  for (let i = 0; i < totalRuns; i++) {
    const offset = i * 4;
    const lineIndex = runs[offset]!;
    const colStart = runs[offset + 1]!;
    const colEnd = runs[offset + 2]!;
    const colorIndex = runs[offset + 3]!;

    if (lineIndex >= lineStart && lineIndex < actualEnd) {
      const relativeLine = lineIndex - lineStart;
      const rawLine = slicedLines[relativeLine] ?? '';
      const content = rawLine.slice(colStart, colEnd);
      const color = palette[colorIndex];

      result[relativeLine]?.push({
        content,
        offset: colStart,
        ...(color && color.length > 0 ? { color } : {}),
      });
    }
  }

  return result;
}

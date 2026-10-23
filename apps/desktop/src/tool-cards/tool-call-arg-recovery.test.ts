import { describe, expect, it } from 'vitest';
import {
  formatEditDiffStats,
  formatReadLineRange,
  recoverToolArgsFromInputPreview,
} from './tool-call-arg-recovery';

describe('formatReadLineRange', () => {
  it('uses explicit start/end lines', () => {
    expect(formatReadLineRange({ start_line: 1, end_line: 80 })).toBe('L1-80');
  });

  it('treats offset + limit as a 1-based line span', () => {
    expect(formatReadLineRange({ offset: 1, limit: 80 })).toBe('L1-80');
    expect(formatReadLineRange({ offset: 0, limit: 80 })).toBe('L1-80');
  });
});

describe('formatEditDiffStats', () => {
  it('counts write content as additions', () => {
    expect(formatEditDiffStats({ path: 'a.md', content: 'one\ntwo\nthree' })).toEqual({
      added: 3,
      removed: 0,
    });
  });

  it('counts str-replace old/new strings', () => {
    expect(
      formatEditDiffStats({ old_string: 'a\nb', new_string: 'a\nb\nc\nd' }),
    ).toEqual({ added: 4, removed: 2 });
  });
});

describe('recoverToolArgsFromInputPreview', () => {
  it('recovers path, range, and write stats from JSON args', () => {
    const recovered = recoverToolArgsFromInputPreview(
      JSON.stringify({ path: 'src/tool-group-clustering.ts', offset: 1, limit: 80 }),
    );
    expect(recovered.paths).toEqual(['src/tool-group-clustering.ts']);
    expect(recovered.lineRange).toBe('L1-80');
  });

  it('recovers a path from truncated JSON', () => {
    const recovered = recoverToolArgsFromInputPreview(
      '{"path":"README.md","content":"# hi',
    );
    expect(recovered.paths).toEqual(['README.md']);
  });
});

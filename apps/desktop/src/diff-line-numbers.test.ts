import { describe, expect, it } from 'vitest';
import { computeDiffLineNumbers } from './diff-line-numbers';
import { parseUnifiedDiff } from './diff-view';

describe('computeDiffLineNumbers', () => {
  it('returns empty for an empty patch', () => {
    expect(computeDiffLineNumbers(parseUnifiedDiff(''))).toEqual([]);
  });

  it('assigns old/new line numbers from the hunk header', () => {
    const patch = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..abcdefg 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -10,5 +12,6 @@',
      ' context line A',
      '-old line B',
      ' context line C',
      '+new line D',
      '+new line E',
    ].join('\n');

    const lines = parseUnifiedDiff(patch);
    const nums = computeDiffLineNumbers(lines);

    // meta lines (diff/index/---/+++) → null
    expect(nums[0]).toEqual({ old: null, new: null });
    expect(nums[1]).toEqual({ old: null, new: null });
    expect(nums[2]).toEqual({ old: null, new: null });
    expect(nums[3]).toEqual({ old: null, new: null });

    // hunk header → null
    expect(nums[4]).toEqual({ old: null, new: null });

    // @@ -10,5 +12,6 @@ → first context line is old 10 / new 12
    expect(nums[5]).toEqual({ old: 10, new: 12 });
    // del → old 11, new null
    expect(nums[6]).toEqual({ old: 11, new: null });
    // context → old 12 / new 13
    expect(nums[7]).toEqual({ old: 12, new: 13 });
    // add → old null / new 14
    expect(nums[8]).toEqual({ old: null, new: 14 });
    // add → old null / new 15
    expect(nums[9]).toEqual({ old: null, new: 15 });
  });

  it('handles a hunk header with implicit length 1', () => {
    const patch = ['@@ -1 +1 @@', '-a', '+b'].join('\n');
    const lines = parseUnifiedDiff(patch);
    const nums = computeDiffLineNumbers(lines);
    expect(nums[1]).toEqual({ old: 1, new: null });
    expect(nums[2]).toEqual({ old: null, new: 1 });
  });

  it('resets counters across multiple hunks', () => {
    const patch = ['@@ -1,2 +1,2 @@', ' a', ' b', '@@ -10,2 +10,2 @@', ' c', '-d', '+e'].join('\n');
    const lines = parseUnifiedDiff(patch);
    const nums = computeDiffLineNumbers(lines);
    // first hunk context
    expect(nums[1]).toEqual({ old: 1, new: 1 });
    expect(nums[2]).toEqual({ old: 2, new: 2 });
    // second hunk header resets to 10
    expect(nums[4]).toEqual({ old: 10, new: 10 });
    expect(nums[5]).toEqual({ old: 11, new: null });
    expect(nums[6]).toEqual({ old: null, new: 11 });
  });
});

import { describe, expect, it } from 'vitest';
import { countPatchStats } from './file-diff.js';

describe('countPatchStats', () => {
  it('counts additions and deletions from unified hunks', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,3 +1,4 @@',
      ' keep',
      '-old',
      '+new',
      '+extra',
      ' keep2',
    ].join('\n');
    expect(countPatchStats(patch)).toEqual({ additions: 2, deletions: 1 });
  });

  it('returns empty when no hunks', () => {
    expect(countPatchStats('not a patch')).toEqual({});
  });
});

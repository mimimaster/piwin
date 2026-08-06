import { describe, expect, it } from 'vitest';
import { parseGitBranchListOutput } from './branch-list.js';

describe('parseGitBranchListOutput', () => {
  it('parses name, short hash, and current marker', () => {
    const stdout = [
      'main\x1fabc1234\x1f*',
      'feat/ui\x1fdef5678\x1f',
      'fix/typo\x1f\x1f',
    ].join('\n');

    const branches = parseGitBranchListOutput(stdout);
    expect(branches).toEqual([
      { name: 'main', current: true, shortHash: 'abc1234' },
      { name: 'feat/ui', current: false, shortHash: 'def5678' },
      { name: 'fix/typo', current: false, shortHash: null },
    ]);
  });

  it('skips blank lines', () => {
    expect(parseGitBranchListOutput('\n\nmain\x1fabc\x1f*\n\n')).toEqual([
      { name: 'main', current: true, shortHash: 'abc' },
    ]);
  });
});

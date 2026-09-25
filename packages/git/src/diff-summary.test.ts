import { describe, expect, it } from 'vitest';
import {
  mergeDiffSummaryFiles,
  parseNameStatus,
  parseNumstat,
} from './diff-summary.js';
import { parsePorcelainStatus } from './status-parser.js';

describe('parseNumstat', () => {
  it('parses additions/deletions, binary rows, and rename paths', () => {
    const files = parseNumstat(
      [
        '10\t2\tsrc/a.ts',
        '-\t-\tassets/logo.png',
        '0\t5\tsrc/b.ts',
        '2\t0\told.ts => new.ts',
      ].join('\n'),
    );
    expect(files).toHaveLength(4);
    expect(files[0]).toMatchObject({ path: 'src/a.ts', additions: 10, deletions: 2, isBinary: false });
    expect(files[1]).toMatchObject({
      path: 'assets/logo.png',
      additions: 0,
      deletions: 0,
      isBinary: true,
    });
    expect(files[2]).toMatchObject({ path: 'src/b.ts', additions: 0, deletions: 5, isBinary: false });
    expect(files[3]).toMatchObject({
      path: 'new.ts',
      previousPath: 'old.ts',
      additions: 2,
      deletions: 0,
    });
  });
});

describe('parseNameStatus', () => {
  it('parses status letters including rename scores', () => {
    const files = parseNameStatus(
      ['M\tsrc/a.tsx', 'A\tnew.ts', 'D\tgone.ts', 'R052\told.ts\trenamed.ts'].join('\n'),
    );
    expect(files).toEqual([
      { path: 'src/a.tsx', status: 'modified' },
      { path: 'new.ts', status: 'added' },
      { path: 'gone.ts', status: 'deleted' },
      { path: 'renamed.ts', previousPath: 'old.ts', status: 'renamed' },
    ]);
  });
});

describe('mergeDiffSummaryFiles', () => {
  it('keeps a tracked edit with only additions as modified', () => {
    const files = mergeDiffSummaryFiles(
      parseNameStatus('M\tsrc/Widget.tsx'),
      parseNumstat('14\t0\tsrc/Widget.tsx'),
    );
    expect(files).toEqual([
      { path: 'src/Widget.tsx', status: 'modified', additions: 14, deletions: 0 },
    ]);
  });

  it('reports a new file as added', () => {
    const files = mergeDiffSummaryFiles(
      parseNameStatus('A\tsrc/new.ts'),
      parseNumstat('3\t0\tsrc/new.ts'),
    );
    expect(files).toEqual([{ path: 'src/new.ts', status: 'added', additions: 3, deletions: 0 }]);
  });

  it('reports a deleted file as deleted', () => {
    const files = mergeDiffSummaryFiles(
      parseNameStatus('D\tsrc/gone.ts'),
      parseNumstat('0\t8\tsrc/gone.ts'),
    );
    expect(files).toEqual([{ path: 'src/gone.ts', status: 'deleted', additions: 0, deletions: 8 }]);
  });

  it('reports a rename as renamed and uses the destination path', () => {
    const files = mergeDiffSummaryFiles(
      parseNameStatus('R100\told.ts\tnew.ts'),
      parseNumstat('2\t0\told.ts => new.ts'),
    );
    expect(files).toEqual([{ path: 'new.ts', status: 'renamed', additions: 2, deletions: 0 }]);
  });

  it('reports a binary file from name-status, with zero line counts', () => {
    const files = mergeDiffSummaryFiles(
      parseNameStatus('M\tassets/logo.png'),
      parseNumstat('-\t-\tassets/logo.png'),
    );
    expect(files).toEqual([
      { path: 'assets/logo.png', status: 'modified', additions: 0, deletions: 0 },
    ]);
  });

  it('appends untracked files from porcelain that numstat omits', () => {
    const files = mergeDiffSummaryFiles(
      parseNameStatus('M\tsrc/a.ts'),
      parseNumstat('1\t1\tsrc/a.ts'),
      parsePorcelainStatus(['?? scratch.ts', ' M src/a.ts'].join('\n')).changedFiles,
    );
    expect(files).toEqual([
      { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 },
      { path: 'scratch.ts', status: 'untracked', additions: 0, deletions: 0 },
    ]);
  });
});

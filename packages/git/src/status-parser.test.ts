import { describe, expect, it } from 'vitest';
import { parsePorcelainFileLine, parsePorcelainStatus } from './status-parser.js';

describe('parsePorcelainStatus', () => {
  it('parses branch tracking and dirty files', () => {
    const stdout = [
      '## main...origin/main [ahead 1, behind 2]',
      ' M src/a.ts',
      'A  src/b.ts',
      '?? src/c.ts',
      'R  old.ts -> new.ts',
    ].join('\n');

    const parsed = parsePorcelainStatus(stdout);
    expect(parsed.branch.currentBranch).toBe('main');
    expect(parsed.branch.upstreamBranch).toBe('origin/main');
    expect(parsed.branch.ahead).toBe(1);
    expect(parsed.branch.behind).toBe(2);
    expect(parsed.branch.dirty).toBe(true);
    expect(parsed.changedFiles).toHaveLength(4);
    expect(parsed.changedFiles[0]).toMatchObject({
      path: 'src/a.ts',
      status: 'modified',
      staged: false,
      unstaged: true,
    });
    expect(parsed.changedFiles[1]).toMatchObject({
      path: 'src/b.ts',
      status: 'added',
      staged: true,
    });
    expect(parsed.changedFiles[2]?.status).toBe('untracked');
    expect(parsed.changedFiles[3]).toMatchObject({
      path: 'new.ts',
      previousPath: 'old.ts',
      status: 'renamed',
    });
  });

  it('detects detached HEAD', () => {
    const parsed = parsePorcelainStatus('## HEAD (no branch)\n');
    expect(parsed.branch.isDetached).toBe(true);
    expect(parsed.branch.currentBranch).toBeNull();
  });
});

describe('parsePorcelainFileLine', () => {
  it('returns null for short lines', () => {
    expect(parsePorcelainFileLine('')).toBeNull();
  });
});

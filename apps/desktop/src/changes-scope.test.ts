import { describe, expect, it } from 'vitest';
import {
  buildChangeRows,
  DEFAULT_EXPANDED_FILES,
  diffScopeFor,
  isSectionExpanded,
  nextStageAction,
  rowsInScope,
  stageStateOf,
  tallyScope,
} from './changes-scope';

const rows = buildChangeRows(
  [
    { path: 'a.ts', status: 'modified', staged: true, unstaged: false },
    { path: 'b.ts', status: 'modified', staged: true, unstaged: true },
    { path: 'c.ts', status: 'untracked', staged: false, unstaged: true },
  ],
  [
    { path: 'a.ts', status: 'modified', additions: 4, deletions: 1 },
    { path: 'b.ts', status: 'modified', additions: 2, deletions: 3 },
  ],
);

describe('changes scope model', () => {
  it('merges summary stats into status rows, zero when the summary has none', () => {
    expect(rows.map((row) => [row.path, row.additions, row.deletions])).toEqual([
      ['a.ts', 4, 1],
      ['b.ts', 2, 3],
      ['c.ts', 0, 0],
    ]);
  });

  it('slices the tree per scope; a partly staged file is in both slices', () => {
    expect(rowsInScope(rows, 'uncommitted').map((row) => row.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(rowsInScope(rows, 'staged').map((row) => row.path)).toEqual(['a.ts', 'b.ts']);
    expect(rowsInScope(rows, 'unstaged').map((row) => row.path)).toEqual(['b.ts', 'c.ts']);
  });

  it('asks Host for the patch that matches the scope', () => {
    expect(diffScopeFor('uncommitted')).toBe('combined');
    expect(diffScopeFor('staged')).toBe('staged');
    expect(diffScopeFor('unstaged')).toBe('worktree');
  });

  it('counts lines only where the HEAD-relative summary is exact', () => {
    expect(tallyScope(rows, 'uncommitted')).toEqual({ files: 3, additions: 6, deletions: 4 });
    expect(tallyScope(rows, 'staged')).toEqual({ files: 2, additions: null, deletions: null });
  });

  it('stages anything with unstaged edits and unstages only a fully staged file', () => {
    expect(rows.map(stageStateOf)).toEqual(['staged', 'partial', 'unstaged']);
    expect(rows.map(nextStageAction)).toEqual(['unstage', 'stage', 'stage']);
  });

  it('opens the first files by default and honours explicit toggles', () => {
    const none = new Map<string, boolean>();
    expect(isSectionExpanded('x', DEFAULT_EXPANDED_FILES - 1, none)).toBe(true);
    expect(isSectionExpanded('x', DEFAULT_EXPANDED_FILES, none)).toBe(false);
    expect(isSectionExpanded('x', 0, new Map([['x', false]]))).toBe(false);
    expect(isSectionExpanded('x', 99, new Map([['x', true]]))).toBe(true);
  });
});

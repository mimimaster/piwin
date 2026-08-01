import { describe, expect, it } from 'vitest';
import { formatDocCommentsForPrompt, mergeComposerWithDocComments } from './doc-comments';

describe('formatDocCommentsForPrompt', () => {
  it('returns empty string for no comments', () => {
    expect(formatDocCommentsForPrompt('Walkthrough', [])).toBe('');
  });

  it('formats title, quoted line, and comment body', () => {
    const out = formatDocCommentsForPrompt('Walkthrough', [
      {
        id: '1',
        lineId: 'list-0',
        lineText: 'Font System: Adopted -apple-system',
        commentText: 'Use Inter only',
      },
    ]);
    expect(out).toContain('## Comments on `Walkthrough` (1)');
    expect(out).toContain('> Font System: Adopted -apple-system');
    expect(out).toContain('Use Inter only');
  });
});

describe('mergeComposerWithDocComments', () => {
  it('prepends comment block before user text', () => {
    const merged = mergeComposerWithDocComments('please fix this', 'Plan', [
      {
        id: '1',
        lineId: 'h-1',
        lineText: 'Step 2',
        commentText: 'skip this step',
      },
    ]);
    expect(merged.startsWith('## Comments on `Plan`')).toBe(true);
    expect(merged.endsWith('please fix this')).toBe(true);
  });

  it('returns only comments when composer empty', () => {
    const merged = mergeComposerWithDocComments('', 'Plan', [
      { id: '1', lineId: 'a', lineText: 'x', commentText: 'y' },
    ]);
    expect(merged).toContain('## Comments on `Plan`');
    expect(merged).not.toContain('please');
  });
});

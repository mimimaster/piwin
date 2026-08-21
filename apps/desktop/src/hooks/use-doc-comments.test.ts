import { describe, expect, it } from 'vitest';
import { mergeComposerWithDocComments } from '../doc-comments';
import { documentCommentKey } from './use-doc-comments.js';
import type { ActiveDocument } from '../active-document';

function readyDoc(partial: Partial<Extract<ActiveDocument, { status: 'ready' }>>): ActiveDocument {
  return {
    status: 'ready',
    requestId: 'req-1',
    title: 'Notes',
    content: '# hi',
    displayRef: 'notes.md',
    provenance: 'project-current',
    ...partial,
  };
}

describe('documentCommentKey', () => {
  it('prefers filePath, then title, then default', () => {
    expect(documentCommentKey(readyDoc({ filePath: 'src/a.ts', title: 'A' }))).toBe('src/a.ts');
    expect(documentCommentKey(readyDoc({ filePath: null, title: 'Notes' }))).toBe('Notes');
    expect(documentCommentKey(null)).toBe('default');
  });
});

describe('mergeComposerWithDocComments (send path)', () => {
  it('clears to composer-only text when there are no comments', () => {
    expect(mergeComposerWithDocComments('please review', 'Notes', [])).toBe('please review');
  });

  it('prepends the comment block so the model sees the annotated lines', () => {
    const merged = mergeComposerWithDocComments('please review', 'Notes', [
      { id: 'c1', lineId: 'L1', lineText: 'const x = 1', commentText: 'why 1?' },
    ]);
    expect(merged).toContain('## Comments on `Notes` (1)');
    expect(merged).toContain('why 1?');
    expect(merged.endsWith('please review')).toBe(true);
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  readKnowledgeRecentReads,
  rememberKnowledgeRecentRead,
} from './knowledge-workspace-recents.js';

afterEach(() => {
  localStorage.removeItem('piwin:knowledge-recent-reads');
});

describe('knowledge recent reads', () => {
  it('keeps the latest open first and does not duplicate the same document', () => {
    rememberKnowledgeRecentRead({
      kind: 'document',
      title: 'fsrs',
      openedAt: '2026-11-01T00:00:00.000Z',
      baseId: 'folder:a',
      relativePath: 'fsrs.md',
      startLine: 12,
    });
    rememberKnowledgeRecentRead({
      kind: 'wiki',
      title: 'FSRS',
      openedAt: '2026-11-02T00:00:00.000Z',
      slug: 'fsrs',
    });
    rememberKnowledgeRecentRead({
      kind: 'document',
      title: 'fsrs (again)',
      openedAt: '2026-11-03T00:00:00.000Z',
      baseId: 'folder:a',
      relativePath: 'fsrs.md',
      startLine: 40,
    });
    const recents = readKnowledgeRecentReads();
    expect(recents).toHaveLength(2);
    expect(recents[0]).toMatchObject({ kind: 'document', title: 'fsrs (again)', startLine: 40 });
    expect(recents[1]).toMatchObject({ kind: 'wiki', slug: 'fsrs' });
  });
});

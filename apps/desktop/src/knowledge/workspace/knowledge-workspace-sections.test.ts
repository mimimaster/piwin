import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_WORKSPACE_SECTIONS,
  knowledgeSectionMeta,
  resolveKnowledgeSection,
} from './knowledge-workspace-sections.js';

describe('knowledge workspace sections', () => {
  it('lists the four fixed sections in navigation order', () => {
    expect(KNOWLEDGE_WORKSPACE_SECTIONS.map((entry) => entry.section)).toEqual([
      'overview',
      'materials',
      'wiki',
      'flashcards',
    ]);
  });

  it('opens the overview for a plain entry', () => {
    expect(resolveKnowledgeSection({})).toBe('overview');
    expect(resolveKnowledgeSection({ initialTab: undefined })).toBe('overview');
  });

  it('keeps every legacy entry pointing at the same content it used to show', () => {
    expect(resolveKnowledgeSection({ initialTab: 'flashcards' })).toBe('flashcards');
    expect(resolveKnowledgeSection({ initialTab: 'wiki' })).toBe('wiki');
    // `documents` meant "wiki with the source drawer open" — that was the
    // materials list, so it must not silently land on the reading surface.
    expect(resolveKnowledgeSection({ initialTab: 'documents' })).toBe('materials');
  });

  it('treats an explicit folder path as a materials request', () => {
    expect(resolveKnowledgeSection({ initialTab: 'wiki', initialFolderPath: '/docs/fsrs' })).toBe(
      'materials',
    );
    expect(resolveKnowledgeSection({ initialTab: 'wiki', initialFolderPath: '   ' })).toBe('wiki');
  });

  it('refuses an unknown section instead of rendering a blank surface', () => {
    expect(() => knowledgeSectionMeta('nope' as never)).toThrow(/Unknown knowledge section/);
  });
});

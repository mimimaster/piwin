import { describe, expect, it } from 'vitest';
import type { FlashcardStudyCatalogPage } from '@piwin/contracts';
import {
  hostPathBasename,
  isHostAbsolutePath,
  MOBILE_SOURCE_FULL_OPEN_HINT,
  mobileSourceProjection,
  stripHostAbsolutePaths,
} from './catalog-paths.js';

describe('catalog path sanitization', () => {
  it('detects Host absolute paths', () => {
    expect(isHostAbsolutePath('/Users/yorick/.piwin/flashcards/cards/a.md')).toBe(true);
    expect(isHostAbsolutePath('C:\\Users\\host\\card.md')).toBe(true);
    expect(isHostAbsolutePath('~/notes/os.md')).toBe(true);
    expect(isHostAbsolutePath('page table')).toBe(false);
  });

  it('omits absolute paths from catalog projections', () => {
    const leaked: FlashcardStudyCatalogPage = {
      tiles: [
        {
          kind: 'single',
          id: 'card-1',
          count: 1,
          preview: 'What is a page table?',
          deck: '/Users/host/.piwin/decks',
        },
      ],
      dueCount: 1,
      newCount: 0,
      unfinishedRounds: [],
    };
    const sanitized = stripHostAbsolutePaths(leaked);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('/Users/host');
    expect(serialized).not.toContain('.piwin');
    expect(sanitized.tiles[0]?.preview).toBe('What is a page table?');
  });

  it('keeps a basename for source titles and never claims the phone opened a Host path', () => {
    expect(hostPathBasename('/Users/host/notes/tlb.md')).toBe('tlb.md');
    const projection = mobileSourceProjection({
      sourceTitle: '/Users/host/notes/tlb.md',
      sourceExcerpt: 'Translation lookaside buffer.',
    });
    expect(projection.title).toBe('tlb.md');
    expect(projection.excerpt).toContain('lookaside');
    expect(projection.hint).toBe(MOBILE_SOURCE_FULL_OPEN_HINT);
    expect(JSON.stringify(projection)).not.toContain('/Users/host');
  });
});

import { describe, expect, it } from 'vitest';
import type { FlashcardReviewCard } from '@piwin/contracts';
import { buildFlashcardArtifactHtml, buildFlashcardBatchArtifactHtml } from './artifact-template.js';

function makeCard(overrides?: Partial<FlashcardReviewCard>): FlashcardReviewCard {
  return {
    cardId: 'card-abc12345-xyz',
    itemId: 'card-abc12345-xyz',
    model: 'basic',
    ordinal: 1,
    deck: 'srs',
    front: '什么是 FSRS？',
    back: '一种间隔重复调度算法。',
    createdAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildFlashcardArtifactHtml', () => {
  it('embeds card content and posts the whitelisted rate action', () => {
    const html = buildFlashcardArtifactHtml(makeCard());
    expect(html).toContain('什么是 FSRS？');
    expect(html).toContain('一种间隔重复调度算法。');
    expect(html).toContain("postAction('flashcard/rate'");
    expect(html).toContain("cardId: 'card-abc12345-xyz'");
    for (const rating of ['again', 'hard', 'good', 'easy']) {
      expect(html).toContain(`'${rating}'`);
    }
  });

  it('escapes HTML in card content (XSS guard)', () => {
    const html = buildFlashcardArtifactHtml(
      makeCard({ front: '<script>alert(1)</script>', back: '"><img src=x>' }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('"><img src=x>');
  });

  it('uses only theme variables, no external resources', () => {
    const html = buildFlashcardArtifactHtml(makeCard());
    expect(html).toContain('var(--piwin-artifact-surface)');
    expect(html).not.toContain('https://');
    expect(html).not.toContain('http://');
  });

  it('open card (no source) has no source indicator or popover', () => {
    const html = buildFlashcardArtifactHtml(makeCard());
    expect(html).not.toContain('fc-source-indicator');
    expect(html).not.toContain('fc-source-popover');
    expect(html).not.toContain('flashcard/open-source');
  });

  it('folder-sourced card has indicator, popover, path, excerpt, and open-source button', () => {
    const html = buildFlashcardArtifactHtml(
      makeCard({
        sourceFolder: '/home/user/docs',
        sourceFile: 'intro.md',
        sourceLine: 42,
        sourceExcerpt: 'RAG combines retrieval with generation.',
      }),
    );
    expect(html).toContain('fc-source-indicator');
    expect(html).toContain('fc-source-popover');
    expect(html).toContain('intro.md:42');
    expect(html).toContain('RAG combines retrieval with generation.');
    expect(html).toContain("postAction('flashcard/open-source'");
    expect(html).toContain("cardId: 'card-abc12345-xyz'");
  });

  it('note-sourced card has indicator and popover but no open-source button', () => {
    const html = buildFlashcardArtifactHtml(
      makeCard({ sourceNoteId: 'note-1', sourceExcerpt: 'excerpt' }),
    );
    expect(html).toContain('fc-source-indicator');
    expect(html).toContain('fc-source-popover');
    expect(html).toContain('note:note-1');
    expect(html).not.toContain('flashcard/open-source');
  });

  it('uses the cloze review cardId in the rate payload', () => {
    const html = buildFlashcardArtifactHtml(
      makeCard({
        cardId: 'abc:c1',
        itemId: 'abc',
        model: 'cloze',
        ordinal: 1,
        front: '线粒体是[…]的能量工厂。',
        back: '线粒体是**细胞**的能量工厂。',
      }),
    );
    expect(html).toContain("cardId: 'abc:c1'");
    expect(html).toContain('线粒体是[…]的能量工厂。');
  });

  it('preview cards (ordinal 0) flip without FSRS rating', () => {
    const html = buildFlashcardArtifactHtml(
      makeCard({
        cardId: 'abc',
        itemId: 'abc',
        model: 'cloze',
        ordinal: 0,
        front: '线粒体是[…]的[…]。',
        back: '线粒体是**细胞**的**能量工厂**。',
      }),
    );
    expect(html).toContain('线粒体是[…]的[…]。');
    expect(html).not.toContain('class="fc-rate"');
    expect(html).not.toContain('本次复习掌握程度');
  });
});

describe('buildFlashcardBatchArtifactHtml', () => {
  it('stacks multiple cards, each with its own cardId in payloads', () => {
    const cards = [
      makeCard({ cardId: 'card-aaa-111', itemId: 'card-aaa-111' }),
      makeCard({
        cardId: 'card-bbb-222',
        itemId: 'card-bbb-222',
        front: 'second question',
      }),
    ];
    const html = buildFlashcardBatchArtifactHtml(cards);
    expect(html).toContain('card-aaa-111');
    expect(html).toContain('card-bbb-222');
    expect(html).toContain('second question');
    expect(html).toContain('piwin-flashcard-batch');
    expect(html).toContain("cardId: 'card-aaa-111'");
    expect(html).toContain("cardId: 'card-bbb-222'");
  });

  it('escapes HTML across all cards in the batch', () => {
    const html = buildFlashcardBatchArtifactHtml([
      makeCard({ cardId: 'card-x', itemId: 'card-x', front: '<script>x</script>' }),
    ]);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

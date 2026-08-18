import { describe, expect, it } from 'vitest';
import type { FlashcardItem } from '@piwin/contracts';
import {
  CLOZE_BLANK,
  expandItemToReviewCards,
  isValidClozeText,
  itemPreviewText,
  listClozeOrdinals,
  parseReviewCardId,
  projectCloze,
  projectClozeCombined,
  itemToDisplayCard,
  displayCardsFromItems,
  collapseToPhysicalCards,
  reviewCardId,
  reviewStateFileName,
  stripClozeMarkers,
} from './cloze.js';

const GOLDEN = '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。';

function clozeItem(text: string, id = 'abc'): FlashcardItem {
  return {
    id,
    model: 'cloze',
    deck: 'default',
    text,
    createdAt: '2026-08-18T00:00:00.000Z',
  };
}

describe('cloze parse', () => {
  it('lists distinct ordinals in ascending order', () => {
    expect(listClozeOrdinals(GOLDEN)).toEqual([1, 2]);
    expect(listClozeOrdinals('{{c1::A}} and {{c1::B}} and {{c3::C}}')).toEqual([1, 3]);
  });

  it('strips markers to the answers', () => {
    expect(stripClozeMarkers(GOLDEN)).toBe('线粒体是细胞的能量工厂。');
  });

  it('treats hint as discarded extra on the marker', () => {
    expect(stripClozeMarkers('见{{c1::线粒体::细胞器}}')).toBe('见线粒体');
    expect(projectCloze('见{{c1::线粒体::细胞器}}', 1)).toEqual({
      front: `见${CLOZE_BLANK}`,
      back: '见**线粒体**',
    });
  });

  it('rejects empty answers, zero ordinals, and more than 8 ordinals', () => {
    expect(isValidClozeText('no markers')).toBe(false);
    expect(isValidClozeText('{{c1::}}')).toBe(false);
    const nine = Array.from({ length: 9 }, (_, index) => `{{c${index + 1}::x}}`).join(' ');
    expect(isValidClozeText(nine)).toBe(false);
    expect(isValidClozeText(GOLDEN)).toBe(true);
  });
});

describe('cloze projection', () => {
  it('combined projection hides every hole on one physical card', () => {
    expect(projectClozeCombined(GOLDEN)).toEqual({
      front: `线粒体是${CLOZE_BLANK}的${CLOZE_BLANK}。`,
      back: '线粒体是**细胞**的**能量工厂**。',
    });
  });

  it('hides only the current ordinal (Anki default)', () => {
    expect(projectCloze(GOLDEN, 1)).toEqual({
      front: `线粒体是${CLOZE_BLANK}的能量工厂。`,
      back: '线粒体是**细胞**的能量工厂。',
    });
    expect(projectCloze(GOLDEN, 2)).toEqual({
      front: `线粒体是细胞的${CLOZE_BLANK}。`,
      back: '线粒体是细胞的**能量工厂**。',
    });
  });

  it('same ordinal twice is one card with two blanks', () => {
    const text = '{{c1::foo}} plus {{c1::bar}}';
    expect(projectCloze(text, 1)).toEqual({
      front: `${CLOZE_BLANK} plus ${CLOZE_BLANK}`,
      back: '**foo** plus **bar**',
    });
    expect(expandItemToReviewCards(clozeItem(text))).toHaveLength(1);
    const display = itemToDisplayCard(clozeItem(GOLDEN));
    expect(display?.cardId).toBe('abc');
    expect(display?.ordinal).toBe(0);
    expect(display?.front).toBe(`线粒体是${CLOZE_BLANK}的${CLOZE_BLANK}。`);
    expect(displayCardsFromItems([clozeItem(GOLDEN)])).toHaveLength(1);
  });

  it('collapses per-ordinal review faces of one item into one physical card', () => {
    const expanded = expandItemToReviewCards(clozeItem(GOLDEN));
    expect(expanded).toHaveLength(2);
    const collapsed = collapseToPhysicalCards(expanded);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.itemId).toBe('abc');
    const preview = itemToDisplayCard(clozeItem(GOLDEN));
    expect(preview).not.toBeNull();
    expect(collapseToPhysicalCards([...expanded, preview!])).toEqual([preview]);
  });
});

describe('expand + ids', () => {
  it('expands a two-hole cloze into two review cards', () => {
    const cards = expandItemToReviewCards(clozeItem(GOLDEN));
    expect(cards.map((card) => card.cardId)).toEqual(['abc:c1', 'abc:c2']);
    expect(cards[0]).toMatchObject({
      itemId: 'abc',
      model: 'cloze',
      ordinal: 1,
      front: `线粒体是${CLOZE_BLANK}的能量工厂。`,
      back: '线粒体是**细胞**的能量工厂。',
    });
  });

  it('returns no cards for invalid cloze text', () => {
    expect(expandItemToReviewCards(clozeItem('plain'))).toEqual([]);
  });

  it('projects a basic item as a single review card keyed by item id', () => {
    const [card] = expandItemToReviewCards({
      id: 'basic-1',
      model: 'basic',
      deck: 'srs',
      front: 'Q',
      back: 'A',
      createdAt: '2026-08-18T00:00:00.000Z',
    });
    expect(card).toMatchObject({
      cardId: 'basic-1',
      itemId: 'basic-1',
      model: 'basic',
      ordinal: 1,
      front: 'Q',
      back: 'A',
    });
  });

  it('parses review card ids and review filenames', () => {
    expect(reviewCardId('abc', 1, 'cloze')).toBe('abc:c1');
    expect(reviewCardId('abc', 1, 'basic')).toBe('abc');
    expect(parseReviewCardId('abc:c2')).toEqual({ itemId: 'abc', ordinal: 2 });
    expect(parseReviewCardId('abc')).toEqual({ itemId: 'abc', ordinal: 1 });
    expect(reviewStateFileName('abc:c2')).toBe('abc--c2.json');
    expect(reviewStateFileName('abc')).toBe('abc.json');
  });

  it('preview text is stripped cloze or basic front', () => {
    expect(itemPreviewText(clozeItem(GOLDEN))).toBe('线粒体是细胞的能量工厂。');
    expect(
      itemPreviewText({
        id: 'x',
        model: 'basic',
        deck: 'd',
        front: 'Hello',
        back: 'World',
        createdAt: '2026-08-18T00:00:00.000Z',
      }),
    ).toBe('Hello');
  });
});

import { describe, expect, it } from 'vitest';
import type { FlashcardItem } from '@piwin/contracts';
import {
  extractFlashcardItemIdsFromText,
  reviewCardsForItemIds,
} from './resolve-conversation-flashcards.js';

describe('resolve-conversation-flashcards', () => {
  it('picks card ids out of a model summary', () => {
    expect(
      extractFlashcardItemIdsFromText(
        '已用一次 flashcard_batch_create 创建挖空闪卡\n卡片 ID： card-f3dc5a95-msy8lzjt',
      ),
    ).toEqual(['card-f3dc5a95-msy8lzjt']);
  });

  it('expands matching cloze items into review cards', () => {
    const item: FlashcardItem = {
      id: 'card-f3dc5a95-msy8lzjt',
      model: 'cloze',
      deck: 'default',
      text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
      createdAt: '2026-08-18T05:43:48.281Z',
    };
    const cards = reviewCardsForItemIds([item], ['card-f3dc5a95-msy8lzjt']);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.front).toContain('[…]');
  });
});

import { describe, expect, it } from 'vitest';
import { tearDeckLabels } from './tear-deck-copy';

describe('tearDeckLabels', () => {
  it('uses 下一张 / 结束浏览 / 已浏览 N 张 in zh, never 撕掉 or 掌握', () => {
    const labels = tearDeckLabels('zh-CN');
    expect(labels.tear).toBe('下一张');
    expect(labels.lastCard).toBe('结束浏览');
    expect(labels.deleteCard).toBe('删这张');
    expect(labels.deleteSet).toBe('删整套');
    expect(labels.completedDescription(3)).toBe('已浏览 3 张');
    expect(labels.unnamedDeck).toBe('闪卡');
    const blob = JSON.stringify(labels);
    expect(blob).not.toMatch(/撕掉/);
    expect(blob).not.toMatch(/掌握/);
    expect(labels.completedTitle).not.toMatch(/掌握/);
    expect(labels.completedDescription(1)).not.toMatch(/掌握/);
  });

  it('uses Next / End browsing / Browsed N cards in en', () => {
    const labels = tearDeckLabels('en');
    expect(labels.tear).toBe('Next');
    expect(labels.lastCard).toBe('End browsing');
    expect(labels.deleteCard).toBe('Delete this card');
    expect(labels.deleteSet).toBe('Delete this set');
    expect(labels.completedDescription(2)).toBe('Browsed 2 cards');
    expect(labels.unnamedDeck).toBe('Card');
    expect(labels.completedTitle).not.toMatch(/Mastered/i);
    expect(labels.completedDescription(2)).not.toMatch(/Mastered/i);
  });
});

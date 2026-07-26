import { describe, expect, it } from 'vitest';
import { createInitialReviewState, isNewState, rateCard } from './scheduler.js';
import { buildReviewQueue } from './queue.js';
import { frontSimilarity, findNearDuplicate } from './dedup.js';
import { exportCardsToTsv } from './anki-export.js';
import { encodeCardMarkdown, decodeCardMarkdown } from './card-codec.js';
import type { FlashcardRecord, ReviewState } from '@piwin/contracts';

const NOW = new Date('2026-07-26T12:00:00.000Z');

describe('scheduler (FSRS)', () => {
  it('initial state is new and due immediately', () => {
    const state = createInitialReviewState('c1', NOW);
    expect(isNewState(state)).toBe(true);
    expect(state.due).toBe(NOW.toISOString());
    expect(state.reps).toBe(0);
  });

  it('good rating schedules into the future and increments reps', () => {
    const initial = createInitialReviewState('c1', NOW);
    const next = rateCard(initial, 'good', NOW);
    expect(next.reps).toBe(1);
    expect(isNewState(next)).toBe(false);
    expect(new Date(next.due).getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.stability).toBeGreaterThan(0);
    expect(next.lastReviewedAt).toBe(NOW.toISOString());
  });

  it('easy schedules further out than again', () => {
    const initial = createInitialReviewState('c1', NOW);
    const easy = rateCard(initial, 'easy', NOW);
    const again = rateCard(initial, 'again', NOW);
    expect(new Date(easy.due).getTime()).toBeGreaterThan(new Date(again.due).getTime());
  });

  it('again on a reviewed card increments lapses', () => {
    const initial = createInitialReviewState('c1', NOW);
    const reviewed = rateCard(initial, 'good', NOW);
    const later = new Date(new Date(reviewed.due).getTime() + 24 * 3600 * 1000);
    const lapsed = rateCard(reviewed, 'again', later);
    expect(lapsed.lapses).toBeGreaterThan(reviewed.lapses);
  });

  it('successive good ratings grow the interval (spacing effect)', () => {
    let state = createInitialReviewState('c1', NOW);
    let previousInterval = 0;
    let reviewTime = NOW;
    for (let round = 0; round < 3; round += 1) {
      state = rateCard(state, 'good', reviewTime);
      const interval = new Date(state.due).getTime() - reviewTime.getTime();
      expect(interval).toBeGreaterThanOrEqual(previousInterval);
      previousInterval = interval;
      reviewTime = new Date(state.due);
    }
  });
});

function makeCard(id: string, deck = 'default', createdAt = '2026-01-01T00:00:00.000Z'): FlashcardRecord {
  return { id, deck, front: `front ${id}`, back: `back ${id}`, createdAt };
}

describe('buildReviewQueue', () => {
  it('due first (oldest due first), then new capped by newPerDay', () => {
    const cards = [makeCard('new1'), makeCard('new2'), makeCard('due1'), makeCard('due2')];
    const states = new Map<string, ReviewState>([
      ['new1', createInitialReviewState('new1', NOW)],
      ['new2', createInitialReviewState('new2', NOW)],
      ['due1', { cardId: 'due1', due: '2026-07-25T00:00:00.000Z', stability: 1, difficulty: 5, reps: 2, lapses: 0 }],
      ['due2', { cardId: 'due2', due: '2026-07-20T00:00:00.000Z', stability: 1, difficulty: 5, reps: 3, lapses: 0 }],
    ]);
    const queue = buildReviewQueue({ cards, states, now: NOW, newPerDay: 1 });
    expect(queue.map((item) => item.card.id)).toEqual(['due2', 'due1', 'new1']);
    expect(queue[0]?.isNew).toBe(false);
    expect(queue[2]?.isNew).toBe(true);
  });

  it('excludes future-due cards and respects deck filter + total cap', () => {
    const cards = [makeCard('a', 'x'), makeCard('b', 'y'), makeCard('future', 'x')];
    const states = new Map<string, ReviewState>([
      ['a', createInitialReviewState('a', NOW)],
      ['b', createInitialReviewState('b', NOW)],
      ['future', { cardId: 'future', due: '2030-01-01T00:00:00.000Z', stability: 9, difficulty: 5, reps: 5, lapses: 0 }],
    ]);
    const queue = buildReviewQueue({ cards, states, now: NOW, deck: 'x' });
    expect(queue.map((item) => item.card.id)).toEqual(['a']);
    expect(buildReviewQueue({ cards, states, now: NOW, maxReviewsPerDay: 1 })).toHaveLength(1);
  });
});

describe('dedup', () => {
  it('identical and near-identical fronts are duplicates', () => {
    expect(frontSimilarity('什么是 FSRS 算法？', '什么是FSRS算法?')).toBe(1);
    expect(
      findNearDuplicate('What is the FSRS algorithm used for?', [
        'What is the FSRS algorithm used for??',
      ]),
    ).not.toBeNull();
  });

  it('different questions are not duplicates', () => {
    expect(
      findNearDuplicate('什么是间隔重复？', ['FTS5 的分词器怎么配置？']),
    ).toBeNull();
    expect(frontSimilarity('completely different', 'nothing alike here')).toBeLessThan(0.5);
  });
});

describe('card codec', () => {
  it('round-trips a full card including CJK and source excerpt', () => {
    const card: FlashcardRecord = {
      id: 'card-abc',
      deck: 'srs',
      front: '什么是 FSRS？',
      back: '一种间隔重复调度算法。\n多行内容。',
      sourceNoteId: 'note-1',
      sourceHash: 'hash123',
      sourceExcerpt: '摘录第一行\n摘录第二行',
      tags: ['srs', '学习'],
      createdAt: '2026-07-26T00:00:00.000Z',
    };
    const decoded = decodeCardMarkdown(encodeCardMarkdown(card));
    expect(decoded).toEqual(card);
  });

  it('returns null for malformed input', () => {
    expect(decodeCardMarkdown('no frontmatter')).toBeNull();
    expect(decodeCardMarkdown('---\nid: "x"\n---\nno sections')).toBeNull();
  });
});

describe('anki export', () => {
  it('produces tab-separated lines with flattened newlines', () => {
    const tsv = exportCardsToTsv([
      { ...makeCard('a'), front: 'multi\nline', back: 'tab\there', tags: ['t1', 't2'] },
    ]);
    expect(tsv).toBe('multi<br>line\ttab here\tdefault\tt1 t2\n');
  });

  it('empty input produces empty string', () => {
    expect(exportCardsToTsv([])).toBe('');
  });
});

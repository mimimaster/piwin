import { describe, expect, it } from 'vitest';
import type { FlashcardItem } from '@piwin/contracts';
import { createStudyRound } from './study-round-reducer.js';
import { buildSequenceEntries } from './study-sequence.js';
import { buildStudySnapshot } from './study-snapshot.js';

const NOW = '2026-08-30T12:00:00.000Z';

function item(partial: Partial<FlashcardItem> & { id: string }): FlashcardItem {
  return {
    model: 'basic',
    deck: 'General',
    front: partial.front ?? partial.id,
    back: partial.back ?? `back-${partial.id}`,
    createdAt: NOW,
    ...partial,
  };
}

describe('buildStudySnapshot', () => {
  it('puts back and a basename sourceTitle on current, and keeps nextShell blank', () => {
    const first = item({
      id: 'item-1',
      front: 'Q1',
      back: 'secret-answer',
      sourceFile: '/Users/host/notes/tlb.md',
      sourceExcerpt: 'TLB caches translations',
      sequenceId: 'seq-1',
      position: 1,
    });
    const second = item({
      id: 'item-2',
      front: 'Q2',
      back: 'next-answer-must-not-leak',
      sourceFile: '/Users/host/notes/page-table.md',
      sequenceId: 'seq-1',
      position: 2,
    });
    const round = createStudyRound({
      roundId: 'round-1',
      mode: 'sequence',
      scope: { kind: 'sequence', sequenceId: 'seq-1' },
      entries: buildSequenceEntries([first, second], 'cv-1'),
      controllerIdentity: 'device-a',
      now: NOW,
    });
    const snapshot = buildStudySnapshot({
      round,
      items: new Map([
        [first.id, first],
        [second.id, second],
      ]),
      states: new Map(),
      controllerIdentity: 'device-a',
    });

    expect(round.face).toBe('question');
    expect(snapshot.current?.back).toBe('secret-answer');
    expect(snapshot.current?.sourceTitle).toBe('tlb.md');
    expect(JSON.stringify(snapshot.current)).not.toContain('/Users/host');
    expect(JSON.stringify(snapshot.current)).not.toContain('"sourceFile"');
    expect(snapshot.nextShell).toEqual({
      entryId: round.entries[1]?.entryId,
      itemId: 'item-2',
      contentVersion: 'cv-1',
    });
    expect(JSON.stringify(snapshot.nextShell)).not.toContain('next-answer');
    expect(JSON.stringify(snapshot.nextShell)).not.toContain('Q2');
  });
});

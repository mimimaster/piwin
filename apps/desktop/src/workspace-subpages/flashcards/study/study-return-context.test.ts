import { describe, expect, it } from 'vitest';
import {
  captureStudyReturnContext,
  sameStudyScope,
} from './study-return-context';

describe('study return context', () => {
  it('captures deck, search, scroll, and focus', () => {
    expect(
      captureStudyReturnContext({
        selectedDeck: 'OS',
        search: 'page',
        scrollTop: 120,
        focusTileId: 'seq_os',
      }),
    ).toEqual({
      selectedDeck: 'OS',
      search: 'page',
      scrollTop: 120,
      focusTileId: 'seq_os',
    });
  });

  it('compares study scopes by kind and identity', () => {
    expect(
      sameStudyScope({ kind: 'sequence', sequenceId: 'seq_os' }, { kind: 'sequence', sequenceId: 'seq_os' }),
    ).toBe(true);
    expect(sameStudyScope({ kind: 'all' }, { kind: 'deck', deck: 'OS' })).toBe(false);
    expect(sameStudyScope({ kind: 'item', itemId: 'a' }, { kind: 'item', itemId: 'b' })).toBe(false);
  });
});

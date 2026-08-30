import { describe, expect, it } from 'vitest';
import {
  captureMobileStudyReturnContext,
  scheduledScopeForDeck,
  sameStudyScope,
  studyScopeForTile,
} from './study-return-context.js';

describe('mobile study return context', () => {
  it('captures this device catalog location, not Host truth', () => {
    expect(
      captureMobileStudyReturnContext({
        source: 'catalog',
        selectedDeck: 'OS',
        search: 'page',
        scrollTop: 80,
        focusTileId: 'seq_os',
      }),
    ).toEqual({
      source: 'catalog',
      selectedDeck: 'OS',
      search: 'page',
      scrollTop: 80,
      focusTileId: 'seq_os',
    });
  });

  it('maps tiles and deck chips to Host scopes', () => {
    expect(studyScopeForTile({ kind: 'set', id: 'seq_os', sequenceId: 'seq_os' })).toEqual({
      kind: 'sequence',
      sequenceId: 'seq_os',
    });
    expect(studyScopeForTile({ kind: 'single', id: 'card-1' })).toEqual({
      kind: 'item',
      itemId: 'card-1',
    });
    expect(scheduledScopeForDeck('all')).toEqual({ kind: 'all' });
    expect(scheduledScopeForDeck('OS')).toEqual({ kind: 'deck', deck: 'OS' });
    expect(
      sameStudyScope({ kind: 'sequence', sequenceId: 'a' }, { kind: 'sequence', sequenceId: 'a' }),
    ).toBe(true);
  });
});

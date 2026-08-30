import type { ReactElement } from 'react';
import { itemPreviewText } from '@piwin/flashcards/cloze';
import { IconCards, IconTrash } from '../../shell-icons';
import type { FlashcardTile } from './group-flashcard-tiles';
import { tileCards } from './group-flashcard-tiles';

/** One tile = one lone card or one generated set. Question only. */
export function FlashcardGallery(props: {
  tiles: FlashcardTile[];
  onOpen: (tileId: string) => void;
  onDeleteTile: (tile: FlashcardTile) => void;
  deleteLabel: string;
}): ReactElement {
  return (
    <div className="vault-cards" data-testid="flashcards-library">
      {props.tiles.map((tile) => {
        const cards = tileCards(tile);
        const top = cards[0];
        if (!top) return null;
        const isSet = tile.kind === 'set';
        const deckName = top.deck || 'General';

        return (
          <article
            key={tile.id}
            className={`vault-card${isSet ? ' is-set' : ''}`}
            data-testid={`flashcard-tile-${tile.id}`}
          >
            <button
              type="button"
              className="fcws-tile-face vault-card-face"
              onClick={() => props.onOpen(tile.id)}
            >
              <div className="vault-card-head">
                <span className="vault-card-deck">
                  <IconCards width={12} height={12} aria-hidden="true" className="vault-deck-icon" />
                  <span>{deckName}</span>
                </span>
                {isSet ? (
                  <span className="vault-card-n" title={`${cards.length} cards in set`}>
                    {cards.length} 张
                  </span>
                ) : null}
              </div>
              <p className="vault-card-q">{itemPreviewText(top)}</p>
              <div className="vault-card-foot">
                <span className="vault-card-cue">{isSet ? '打开一套 →' : '打开 →'}</span>
              </div>
            </button>
            <button
              type="button"
              className="vault-card-delete"
              aria-label={props.deleteLabel}
              title={props.deleteLabel}
              data-testid={`flashcard-delete-${tile.id}`}
              onClick={() => props.onDeleteTile(tile)}
            >
              <IconTrash width={13} height={13} aria-hidden="true" />
            </button>
          </article>
        );
      })}
    </div>
  );
}


import { useState, type ReactElement } from 'react';
import { itemAnswerText, itemPreviewText } from '@piwin/flashcards/cloze';
import { IconCards, IconTrash } from '../../shell-icons';
import type { FlashcardTile } from './group-flashcard-tiles';
import { tileCards } from './group-flashcard-tiles';

export type FlashcardGalleryLabels = {
  delete: string;
  openSet: string;
  openOne: string;
  flipToAnswer: string;
  flipToQuestion: string;
  answerFace: string;
};

/**
 * One tile = one lone card or one generated set. Tiles are mini flashcards:
 * clicking the body flips question↔answer in place (no study round, no
 * progress). The corner cue is the only path into the review desk.
 */
export function FlashcardGallery(props: {
  tiles: readonly FlashcardTile[];
  onOpen: (tileId: string) => void;
  onDeleteTile: (tile: FlashcardTile) => void;
  labels: FlashcardGalleryLabels;
}): ReactElement {
  return (
    <div className="vault-cards" data-testid="flashcards-library">
      {props.tiles.map((tile) => (
        <FlashcardTileCard
          key={tile.id}
          tile={tile}
          labels={props.labels}
          onOpen={() => props.onOpen(tile.id)}
          onDelete={() => props.onDeleteTile(tile)}
        />
      ))}
    </div>
  );
}

function FlashcardTileCard(props: {
  tile: FlashcardTile;
  labels: FlashcardGalleryLabels;
  onOpen: () => void;
  onDelete: () => void;
}): ReactElement | null {
  const [showingAnswer, setShowingAnswer] = useState(false);
  const cards = tileCards(props.tile);
  const top = cards[0];
  if (!top) return null;

  const isSet = props.tile.kind === 'set';
  const deckName = top.deck || 'General';
  const questionText = itemPreviewText(top);
  const answerText = itemAnswerText(top);
  const bodyText = showingAnswer ? answerText : questionText;
  const flipLabel = showingAnswer ? props.labels.flipToQuestion : props.labels.flipToAnswer;

  return (
    <article
      className={`vault-card${isSet ? ' is-set' : ''}${showingAnswer ? ' is-answer' : ''}`}
      data-testid={`flashcard-tile-${props.tile.id}`}
    >
      <button
        type="button"
        className="fcws-tile-face vault-card-face"
        aria-pressed={showingAnswer}
        title={flipLabel}
        onClick={() => setShowingAnswer((current) => !current)}
      >
        <div className="vault-card-head">
          <span className="vault-card-deck">
            <IconCards width={12} height={12} aria-hidden="true" className="vault-deck-icon" />
            <span>{deckName}</span>
          </span>
          {showingAnswer ? (
            <span className="vault-card-side" aria-hidden="true">
              {props.labels.answerFace}
            </span>
          ) : isSet ? (
            <span className="vault-card-n" title={`${cards.length} cards in set`}>
              {cards.length} 张
            </span>
          ) : null}
        </div>
        <p className="vault-card-q" data-testid={`flashcard-tile-body-${props.tile.id}`}>
          {bodyText}
        </p>
        <div className="vault-card-foot">
          <span className="vault-card-flip-cue" aria-hidden="true">
            {flipLabel}
          </span>
        </div>
      </button>
      <button
        type="button"
        className="vault-card-open"
        data-testid={`flashcard-open-${props.tile.id}`}
        onClick={props.onOpen}
      >
        {isSet ? props.labels.openSet : props.labels.openOne}
      </button>
      <button
        type="button"
        className="vault-card-delete"
        aria-label={props.labels.delete}
        title={props.labels.delete}
        data-testid={`flashcard-delete-${props.tile.id}`}
        onClick={props.onDelete}
      >
        <IconTrash width={13} height={13} aria-hidden="true" />
      </button>
    </article>
  );
}
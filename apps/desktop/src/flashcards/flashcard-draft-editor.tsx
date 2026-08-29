import type { ReactElement } from 'react';
import { Select, TextArea } from '@piwin/ui-kit';
import type { FlashcardDeckOption } from './flashcard-tutor-draft';

export type FlashcardDraftEditorLabels = {
  deck: string;
  front: string;
  frontPlaceholder: string;
  back: string;
  backPlaceholder: string;
};

export type FlashcardDraftEditorProps = {
  deckOptions: FlashcardDeckOption[];
  deck: string;
  onDeckChange: (deck: string) => void;
  front: string;
  onFrontChange: (front: string) => void;
  back: string;
  onBackChange: (back: string) => void;
  labels: FlashcardDraftEditorLabels;
  disabled?: boolean;
  frontTestId?: string;
  backTestId?: string;
  deckTestId?: string;
};

/** Shared front/back/deck fields for manual create and tutor “make a new card”. */
export function FlashcardDraftEditor(props: FlashcardDraftEditorProps): ReactElement {
  const { labels } = props;
  const disabled = props.disabled === true;
  return (
    <div className="fc-draft-editor" data-testid="flashcard-draft-editor">
      <label className="fcws-dialog-field">
        <span>{labels.deck}</span>
        <Select
          value={props.deck}
          onChange={(event) => props.onDeckChange(event.currentTarget.value)}
          data={props.deckOptions}
          disabled={disabled}
          testId={props.deckTestId ?? 'flashcards-new-deck'}
        />
      </label>
      <TextArea
        label={labels.front}
        placeholder={labels.frontPlaceholder}
        value={props.front}
        onChange={props.onFrontChange}
        disabled={disabled}
        testId={props.frontTestId ?? 'flashcards-new-front'}
      />
      <TextArea
        label={labels.back}
        placeholder={labels.backPlaceholder}
        value={props.back}
        onChange={props.onBackChange}
        disabled={disabled}
        testId={props.backTestId ?? 'flashcards-new-back'}
      />
    </div>
  );
}

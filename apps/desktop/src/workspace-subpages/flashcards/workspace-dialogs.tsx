import type { ReactElement } from 'react';
import { Button, Dialog } from '@piwin/ui-kit';
import { FlashcardDraftEditor } from '../../flashcards/flashcard-draft-editor';

export type CreateCardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckOptions: Array<{ value: string; label: string }>;
  deck: string;
  onDeckChange: (deck: string) => void;
  front: string;
  onFrontChange: (front: string) => void;
  back: string;
  onBackChange: (back: string) => void;
  labels: {
    title: string;
    deck: string;
    front: string;
    frontPlaceholder: string;
    back: string;
    backPlaceholder: string;
    cancel: string;
    save: string;
  };
  onSave: () => void;
};

/** Manual flashcard creation (Host command `flashcards/create`). */
export function CreateCardDialog(props: CreateCardDialogProps): ReactElement {
  const { labels } = props;
  const canSave = props.front.trim() !== '' && props.back.trim() !== '';
  return (
    <Dialog
      label={labels.title}
      open={props.open}
      onOpenChange={props.onOpenChange}
      contentClassName="fcws-dialog"
      testId="flashcards-create-dialog"
    >
      <div className="fcws-dialog-body">
        <h3>{labels.title}</h3>
        <FlashcardDraftEditor
          deckOptions={props.deckOptions}
          deck={props.deck}
          onDeckChange={props.onDeckChange}
          front={props.front}
          onFrontChange={props.onFrontChange}
          back={props.back}
          onBackChange={props.onBackChange}
          labels={{
            deck: labels.deck,
            front: labels.front,
            frontPlaceholder: labels.frontPlaceholder,
            back: labels.back,
            backPlaceholder: labels.backPlaceholder,
          }}
        />
        <div className="fcws-dialog-footer">
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={props.onSave}>
            {labels.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

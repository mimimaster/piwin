import type { ReactElement } from 'react';
import { Button, Dialog, Select, TextArea } from '@piwin/ui-kit';

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
        <label className="fcws-dialog-field">
          <span>{labels.deck}</span>
          <Select
            value={props.deck}
            onChange={(e) => props.onDeckChange(e.currentTarget.value)}
            data={props.deckOptions}
          />
        </label>
        <TextArea
          label={labels.front}
          placeholder={labels.frontPlaceholder}
          value={props.front}
          onChange={props.onFrontChange}
          testId="flashcards-new-front"
        />
        <TextArea
          label={labels.back}
          placeholder={labels.backPlaceholder}
          value={props.back}
          onChange={props.onBackChange}
          testId="flashcards-new-back"
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

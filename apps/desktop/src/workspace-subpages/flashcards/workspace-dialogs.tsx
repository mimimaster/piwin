import type { ReactElement } from 'react';
import { Button, Dialog, TextArea } from '@piwin/ui-kit';
import { FlashcardDraftEditor } from '../../flashcards/flashcard-draft-editor';
import { IconSpark } from '../../shell-icons';

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

export type GenerateCardsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: string;
  onTopicChange: (topic: string) => void;
  labels: {
    title: string;
    hint: string;
    topicLabel: string;
    topicPlaceholder: string;
    cancel: string;
    generate: string;
  };
  onGenerate: () => void;
};

/** AI generation handoff — composes a `/doccards generate` chat prompt. */
export function GenerateCardsDialog(props: GenerateCardsDialogProps): ReactElement {
  const { labels } = props;
  return (
    <Dialog
      label={labels.title}
      open={props.open}
      onOpenChange={props.onOpenChange}
      contentClassName="fcws-dialog"
      testId="flashcards-generate-dialog"
    >
      <div className="fcws-dialog-body">
        <h3>{labels.title}</h3>
        <p className="fcws-generate-hint">{labels.hint}</p>
        <TextArea
          label={labels.topicLabel}
          placeholder={labels.topicPlaceholder}
          value={props.topic}
          onChange={props.onTopicChange}
          testId="flashcards-generate-topic"
        />
        <div className="fcws-dialog-footer">
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={props.topic.trim() === ''}
            onClick={props.onGenerate}
          >
            <IconSpark width={13} height={13} />
            <span>{labels.generate}</span>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

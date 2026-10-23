import type { ReactElement } from 'react';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { FlashcardReviewCard } from '@piwin/contracts';
import { FlashcardStackView } from './FlashcardView';

export type FlashcardResultProjectionProps = {
  cards: readonly FlashcardReviewCard[];
  locale: 'zh-CN' | 'en';
  onAction?: (action: ArtifactActionMessage) => void;
};

/** Shared Conversation + Agent transcript projection for flashcard tool results. */
export function FlashcardResultProjection(
  props: FlashcardResultProjectionProps,
): ReactElement | null {
  if (props.cards.length === 0) return null;
  return (
    <div
      className="conversation-extracted-flashcard"
      data-testid="conversation-extracted-flashcard"
    >
      <FlashcardStackView
        cards={[...props.cards]}
        locale={props.locale}
        {...(props.onAction ? { onAction: props.onAction } : {})}
      />
    </div>
  );
}

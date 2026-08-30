import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { StudioTopbar } from '../../studio/studio-chrome';
import type { DesktopLocale } from '../../../desktop-locale';
import { flashcardStudyCopy } from './study-copy';
import { FlashcardStudyView } from './FlashcardStudyView';
import {
  pauseThenLeave,
  useFlashcardStudy,
  type FlashcardStudyEntry,
} from './use-flashcard-study';
import type { FlashcardStudyPorts } from './study-session';

export type FlashcardStudyRouteProps = {
  locale?: DesktopLocale;
  entry: FlashcardStudyEntry;
  ports: FlashcardStudyPorts;
  onLeave: () => void;
};

export function FlashcardStudyRoute(props: FlashcardStudyRouteProps): ReactElement {
  const locale = props.locale === 'en' ? 'en' : 'zh-CN';
  const copy = flashcardStudyCopy(locale);
  const { view, controller } = useFlashcardStudy(props.entry, props.ports);
  const [markedIds, setMarkedIds] = useState<string[]>([]);
  const current = view.snapshot?.current;

  useEffect(() => {
    if (!current) return;
    setMarkedIds((prev) => {
      const next = new Set(prev);
      if (current.needsReview) next.add(current.itemId);
      else next.delete(current.itemId);
      return [...next];
    });
  }, [current, current?.itemId, current?.needsReview]);

  const leave = useCallback(() => {
    void pauseThenLeave(controller, props.onLeave);
  }, [controller, props.onLeave]);

  const startNewRound = useCallback(() => {
    void controller?.start({
      mode: props.entry.mode,
      scope: props.entry.scope,
      resumeExisting: false,
    });
  }, [controller, props.entry.mode, props.entry.scope]);

  const reinforce = useCallback(() => {
    const roundId = view.snapshot?.round.roundId;
    if (!controller || !roundId || markedIds.length === 0) return;
    void controller.start({
      mode: 'sequence',
      scope: { kind: 'selection', parentRoundId: roundId, itemIds: markedIds },
      resumeExisting: false,
    });
  }, [controller, markedIds, view.snapshot?.round.roundId]);

  return (
    <div className="vault-stage" data-testid="flashcards-study-route">
      <StudioTopbar
        testId="flashcards-study-back-btn"
        backLabel={copy.back}
        onBack={leave}
        {...(props.locale !== undefined ? { locale: props.locale } : {})}
        kind="flashcards"
        actions={
          <span className="vault-bar-context">
            {props.entry.mode === 'scheduled' ? copy.scheduledTitle : copy.sequenceTitle}
          </span>
        }
      />
      <FlashcardStudyView
        view={view}
        controller={controller}
        copy={copy}
        locale={locale}
        needsReviewCount={markedIds.length}
        onLeave={leave}
        onNewRound={startNewRound}
        {...(markedIds.length > 0 ? { onReinforce: reinforce } : {})}
      />
    </div>
  );
}

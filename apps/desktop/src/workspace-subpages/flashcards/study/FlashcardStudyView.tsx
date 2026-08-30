import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button, Dialog, FlashcardFace, Notice, Spinner, TearDeckSurface } from '@piwin/ui-kit';
import type {
  FlashcardStudyContentProjection,
  FlashcardStudySnapshot,
  ReviewRating,
} from '@piwin/contracts';
import type { FlashcardStudyController, FlashcardStudyViewModel } from '@piwin/host-client';
import { IconCheck, IconPause, IconPlay, IconRefresh, IconRevert } from '../../../shell-icons';
import { MarkdownView } from '../../../MarkdownView';
import type { FlashcardStudyCopy } from './study-copy';
import { resolveStudyKeyboard, type StudyKeyboardTarget } from './study-keyboard';
import { StudyRateBar } from './study-rate-bar';

export type FlashcardStudyViewProps = {
  view: FlashcardStudyViewModel;
  controller: FlashcardStudyController | null;
  copy: FlashcardStudyCopy;
  locale: 'zh-CN' | 'en';
  needsReviewCount: number;
  onLeave: () => void;
  onNewRound: () => void;
  onReinforce?: () => void;
};

type FaceHold = {
  current: FlashcardStudyContentProjection | null;
  revealed: boolean;
  tearing: boolean;
  transitionId: string | null;
};

function saveKind(
  view: FlashcardStudyViewModel,
): 'saving' | 'saved' | 'pending' | null {
  if (view.phase === 'pending-confirmation' || view.pendingConfirmation) return 'pending';
  if (view.phase === 'saving') return 'saving';
  if (view.snapshot && view.connected) return 'saved';
  return null;
}

function keyboardTarget(value: EventTarget | null): StudyKeyboardTarget | null {
  if (!(value instanceof HTMLElement)) return null;
  return { tagName: value.tagName, isContentEditable: value.isContentEditable };
}

function markdown(text: string, locale: 'zh-CN' | 'en'): ReactNode {
  return (
    <MarkdownView
      text={text}
      renderingPhase="completed"
      showStreamingCaret={false}
      artifactPreviewEnabled={false}
      locale={locale}
    />
  );
}

export function FlashcardStudyView(props: FlashcardStudyViewProps): ReactElement {
  const { view, controller, copy } = props;
  const snapshot = view.snapshot;
  const mode = snapshot?.round.mode ?? 'sequence';
  const [endConfirm, setEndConfirm] = useState(false);
  const [hold, setHold] = useState<FaceHold>({
    current: snapshot?.current ?? null,
    revealed: snapshot?.round.face === 'answer',
    tearing: false,
    transitionId: null,
  });
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (view.phase === 'transitioning' && view.transitionId) {
      setHold((prev) => ({
        current: prev.current,
        revealed: prev.revealed,
        tearing: true,
        transitionId: view.transitionId,
      }));
      return;
    }
    setHold({
      current: snapshot?.current ?? null,
      revealed: snapshot?.round.face === 'answer',
      tearing: false,
      transitionId: view.transitionId,
    });
  }, [snapshot?.current, view.phase, view.transitionId]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = resolveStudyKeyboard(
        {
          key: event.key,
          repeat: event.repeat,
          isComposing: event.isComposing,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          target: keyboardTarget(event.target),
        },
        { mode, phase: view.phase, overlayOpen: endConfirm },
      );
      if (!action) return;
      event.preventDefault();
      if (action.type === 'close-overlay') {
        setEndConfirm(false);
        return;
      }
      if (action.type === 'leave') {
        props.onLeave();
        return;
      }
      if (!controller) return;
      if (action.type === 'flip') void controller.flip();
      if (action.type === 'next') void controller.next();
      if (action.type === 'rate') void controller.rate(action.rating);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, endConfirm, mode, props, view.phase]);

  const status = snapshot?.round.status;
  const completed = view.phase === 'completed' || status === 'completed' || status === 'ended';
  const paused = view.phase === 'paused';
  const counts = snapshot?.counts;
  const displayCurrent = hold.current;
  const hasNext = Boolean(snapshot?.nextShell);
  const busy =
    view.phase === 'saving' ||
    view.phase === 'transitioning' ||
    view.phase === 'pending-confirmation';

  if (view.phase === 'loading' && !snapshot) {
    return (
      <div className="vault-study-page" data-testid="flashcards-study-page">
        <div className="vault-empty">
          <Spinner label={copy.saving} />
        </div>
      </div>
    );
  }

  if (view.phase === 'error' && view.error?.code === 'host-too-old') {
    return (
      <div className="vault-study-page" data-testid="flashcards-study-page">
        <Notice tone="error" testId="flashcards-study-host-old">
          {copy.hostTooOld}
        </Notice>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="vault-study-page" data-testid="flashcards-study-page">
        {renderCompleted(props, copy)}
      </div>
    );
  }

  const underShell = blankIncomingUnderShell(hold.tearing, snapshot);
  const save = saveKind(view);
  const progressTotal = counts?.total ?? 0;
  const progressIndex =
    progressTotal === 0
      ? 0
      : Math.min(progressTotal, (counts?.processed ?? 0) + (displayCurrent ? 1 : 0));
  const progressPercent =
    progressTotal === 0 ? 0 : Math.round((progressIndex / progressTotal) * 100);

  return (
    <div
      ref={rootRef}
      className="vault-study-page"
      data-testid="flashcards-study-page"
      tabIndex={-1}
    >
      {view.error ? (
        <Notice tone="error" testId="flashcards-study-error">
          {view.error.message}
        </Notice>
      ) : null}
      {view.phase === 'disconnected' ? (
        <Notice tone="warning" testId="flashcards-study-disconnected">
          {copy.disconnected}
        </Notice>
      ) : null}
      {view.phase === 'pending-confirmation' ? (
        <Notice tone="warning" testId="flashcards-study-pending">
          {copy.pendingConfirmation}
        </Notice>
      ) : null}
      {view.readOnly ? (
        <Notice tone="warning" testId="flashcards-study-readonly">
          {copy.readOnly}
          <Button variant="secondary" size="compact" onClick={() => void controller?.claim()}>
            {copy.claim}
          </Button>
        </Notice>
      ) : null}

      <TearDeckSurface
        tearing={hold.tearing}
        {...(hold.transitionId ? { transitionId: hold.transitionId } : {})}
        onTransitionEnd={(id) => controller?.noteTransitionEnd(id)}
        {...(underShell ? { underShell } : {})}
        toolbar={
          <header className="fcws-tear-toolbar">
            <div className="fcws-tear-progress-wrap">
              <span className="fcws-tear-count" data-testid="flashcards-tear-count">
                {progressIndex} / {progressTotal}
              </span>
              <div className="fcws-tear-progress-bar">
                <div className="fcws-tear-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              {save ? (
                <span className="fcws-study-save" data-testid="flashcards-study-save-state">
                  {copy.saveStatus(save)}
                </span>
              ) : null}
            </div>
            <div className="fcws-study-toolbar-actions">
              {snapshot?.canUndo ? (
                <Button
                  variant="ghost"
                  size="compact"
                  data-testid="flashcards-study-undo"
                  disabled={busy}
                  onClick={() => void controller?.undo()}
                >
                  <IconRevert width={13} height={13} />
                  <span>{copy.undo}</span>
                </Button>
              ) : null}
              {paused ? (
                <Button
                  variant="secondary"
                  size="compact"
                  data-testid="flashcards-study-resume"
                  onClick={() => void controller?.resume()}
                >
                  <IconPlay width={13} height={13} />
                  <span>{copy.resume}</span>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="compact"
                  data-testid="flashcards-study-pause"
                  disabled={busy || view.readOnly}
                  onClick={() => void controller?.pause()}
                >
                  <IconPause width={13} height={13} />
                  <span>{copy.pause}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="compact"
                data-testid="flashcards-study-end"
                disabled={view.readOnly}
                onClick={() => setEndConfirm(true)}
              >
                {copy.endRound}
              </Button>
            </div>
          </header>
        }
        current={
          paused ? (
            <article className="fcws-tear-card fcws-study-paused" data-testid="flashcards-study-paused">
              <h3>{copy.pausedTitle}</h3>
              <p>{copy.pausedBody}</p>
            </article>
          ) : displayCurrent ? (
            renderFace(displayCurrent, copy, {
              tearing: hold.tearing,
              revealed: hold.revealed,
              locale: props.locale,
              onFlip: () => void controller?.flip(),
            })
          ) : (
            <article className="fcws-tear-card">
              <h3>{copy.emptyTitle}</h3>
              <p>{copy.emptyBody}</p>
            </article>
          )
        }
        actions={
          paused || !displayCurrent ? (
            <footer className="fcws-tear-actions">
              {paused ? (
                <Button variant="primary" onClick={() => void controller?.resume()}>
                  <IconPlay width={14} height={14} />
                  <span>{copy.resume}</span>
                </Button>
              ) : null}
            </footer>
          ) : (
            renderActions({
              copy,
              mode,
              revealed: hold.revealed,
              hasNext,
              busy,
              needsReview: displayCurrent.needsReview,
              onFlip: () => void controller?.flip(),
              onNext: () => void controller?.next(),
              onRate: (rating) => void controller?.rate(rating),
              onNeedsReview: () => void controller?.setNeedsReview(!displayCurrent.needsReview),
            })
          )
        }
      />

      <Dialog
        label={copy.endRoundTitle}
        open={endConfirm}
        onOpenChange={setEndConfirm}
        testId="flashcards-study-end-confirm"
      >
        <div className="fcws-dialog-body">
          <h3>{copy.endRoundTitle}</h3>
          <p>{copy.endRoundBody}</p>
          <div className="fcws-dialog-footer">
            <Button variant="ghost" onClick={() => setEndConfirm(false)}>
              {copy.cancel}
            </Button>
            <Button
              variant="primary"
              data-testid="flashcards-study-end-confirm-btn"
              onClick={() => {
                setEndConfirm(false);
                void controller?.end();
              }}
            >
              {copy.endRoundConfirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** During tear: blank back of the incoming current card. Idle: blank next shell. No Q/A. */
function blankIncomingUnderShell(
  tearing: boolean,
  snapshot: FlashcardStudySnapshot | null,
): ReactElement | null {
  const showIncoming = tearing && snapshot?.current !== undefined;
  const showNext = !tearing && snapshot?.nextShell !== undefined;
  if (!showIncoming && !showNext) return null;
  return (
    <article
      className="fcws-tear-card"
      aria-hidden="true"
      data-testid="flashcards-study-under-shell"
    />
  );
}

function renderFace(
  current: FlashcardStudyContentProjection,
  copy: FlashcardStudyCopy,
  options: { tearing: boolean; revealed: boolean; locale: 'zh-CN' | 'en'; onFlip: () => void },
): ReactElement {
  const text = options.revealed ? (current.back ?? '') : current.front;
  return (
    <FlashcardFace
      tearing={options.tearing}
      revealed={options.revealed}
      deckName={current.deck || copy.unnamedDeck}
      tag={
        current.tags && current.tags.length > 0 ? (
          <span className="fcws-tear-tag">#{current.tags[0]}</span>
        ) : null
      }
      indexTag={
        current.siblingOrdinal !== undefined && current.siblingCount !== undefined ? (
          <span className="fcws-tear-index-tag">
            {copy.sibling(current.siblingOrdinal, current.siblingCount)}
          </span>
        ) : null
      }
      contentTestId={options.revealed ? 'flashcards-tear-back' : 'flashcards-tear-front'}
      onFlip={options.onFlip}
      content={markdown(text, options.locale)}
      source={
        current.sourceTitle ? (
          <div className="fcws-tear-source-line">
            <span>{current.sourceTitle}</span>
          </div>
        ) : null
      }
    />
  );
}

function renderActions(input: {
  copy: FlashcardStudyCopy;
  mode: 'sequence' | 'scheduled';
  revealed: boolean;
  hasNext: boolean;
  busy: boolean;
  needsReview: boolean;
  onFlip: () => void;
  onNext: () => void;
  onRate: (rating: ReviewRating) => void;
  onNeedsReview: () => void;
}): ReactElement {
  const { copy } = input;
  if (input.mode === 'scheduled' && input.revealed) {
    return (
      <footer className="fcws-tear-actions fcws-study-rate-actions">
        <StudyRateBar copy={copy} disabled={input.busy} onRate={input.onRate} />
      </footer>
    );
  }
  return (
    <footer className="fcws-tear-actions">
      <Button variant="secondary" size="default" onClick={input.onFlip} disabled={input.busy}>
        <span>{input.revealed ? copy.question : copy.answer}</span>
        <kbd className="fc-rate-key">Space</kbd>
      </Button>
      {input.mode === 'sequence' ? (
        input.hasNext ? (
          <Button
            variant="primary"
            size="default"
            data-testid="flashcards-tear-next"
            disabled={input.busy}
            onClick={input.onNext}
          >
            {copy.next}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="default"
            data-testid="flashcards-tear-end"
            disabled={input.busy}
            onClick={input.onNext}
          >
            {copy.lastCard}
          </Button>
        )
      ) : null}
      {input.mode === 'sequence' ? (
        <Button
          variant="ghost"
          size="compact"
          data-testid="flashcards-study-needs-review"
          disabled={input.busy}
          onClick={input.onNeedsReview}
        >
          {input.needsReview ? copy.needsReviewOn : copy.needsReview}
        </Button>
      ) : null}
    </footer>
  );
}

function renderCompleted(props: FlashcardStudyViewProps, copy: FlashcardStudyCopy): ReactElement {
  const snapshot = props.view.snapshot;
  const mode = snapshot?.round.mode ?? 'sequence';
  const ended = snapshot?.round.status === 'ended';
  const processed = snapshot?.counts.processed ?? 0;
  const remaining = snapshot?.counts.remaining ?? 0;
  const title = ended
    ? copy.endedTitle
    : mode === 'scheduled'
      ? copy.scheduledCompletedTitle
      : copy.sequenceCompletedTitle;
  const description = ended
    ? copy.endedBody(processed, remaining)
    : mode === 'scheduled'
      ? copy.scheduledCompleted(processed)
      : copy.sequenceCompleted(processed, props.needsReviewCount);
  return (
    <TearDeckSurface
      completed
      completedContent={
        <>
          <div className="fcws-tear-completed-icon">
            <IconCheck width={32} height={32} />
          </div>
          <h3>{title}</h3>
          <p className="fcws-tear-completed-desc" data-testid="flashcards-study-completed-desc">
            {description}
          </p>
          <div className="fcws-tear-actions fcws-tear-completed-actions">
            <Button
              variant="primary"
              data-testid="flashcards-study-new-round"
              onClick={props.onNewRound}
            >
              <IconRefresh width={14} height={14} />
              <span>{copy.newRound}</span>
            </Button>
            {props.onReinforce && props.needsReviewCount > 0 ? (
              <Button variant="secondary" data-testid="flashcards-study-reinforce" onClick={props.onReinforce}>
                {copy.reinforce}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={props.onLeave}>
              {copy.close}
            </Button>
          </div>
        </>
      }
    />
  );
}

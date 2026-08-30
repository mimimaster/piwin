import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, IconBack, IconCheck, IconPause, IconPlay, IconRefresh, IconRevert, Notice, Spinner, TearDeckSurface } from '@piwin/ui-kit';
import type { FlashcardStudySnapshot } from '@piwin/contracts';
import type { FlashcardStudyController, FlashcardStudyViewModel } from '@piwin/host-client';
import {
  historyStateHasFlashcardsOverlay,
  navigateMobileFlashcardsRoute,
  parseMobileFlashcardsRoute,
  popMobileFlashcardsOverlay,
  pushMobileFlashcardsOverlay,
} from '../../mobile-flashcards-route.js';
import { MOBILE_FLASHCARD_STUDY_COPY as copy } from './study-copy.js';
import { blankIncomingUnderShell, renderStudyActions, renderStudyFace } from './study-face.js';
import { resolveStudyKeyboard, type StudyKeyboardTarget } from './study-keyboard.js';
import type { MobileStudyReturnSource } from './study-return-context.js';
import type { MobileFlashcardStudyPorts } from './study-session.js';
import { pauseIfActive, pauseThenLeave, useFlashcardStudy } from './use-flashcard-study.js';

export type FlashcardStudyPageProps = {
  roundId: string;
  ports: MobileFlashcardStudyPorts;
  returnSource: MobileStudyReturnSource;
  onLeave: () => void;
};

type FaceHold = {
  current: FlashcardStudySnapshot['current'] | null;
  revealed: boolean;
  tearing: boolean;
  transitionId: string | null;
};

function saveKind(view: FlashcardStudyViewModel): 'saving' | 'saved' | 'pending' | null {
  if (view.phase === 'pending-confirmation' || view.pendingConfirmation) return 'pending';
  if (view.phase === 'saving') return 'saving';
  if (view.snapshot && view.connected) return 'saved';
  return null;
}

function keyboardTarget(value: EventTarget | null): StudyKeyboardTarget | null {
  if (!(value instanceof HTMLElement)) return null;
  return { tagName: value.tagName, isContentEditable: value.isContentEditable };
}

export function FlashcardStudyPage(props: FlashcardStudyPageProps): ReactElement {
  const { view, controller, facesConcealed } = useFlashcardStudy(props.roundId, props.ports);
  const [markedIds, setMarkedIds] = useState<string[]>([]);
  const [endConfirm, setEndConfirm] = useState(false);
  const snapshot = view.snapshot;
  const current = snapshot?.current;
  const [hold, setHold] = useState<FaceHold>({
    current: current ?? null,
    revealed: snapshot?.round.face === 'answer',
    tearing: false,
    transitionId: null,
  });
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = endConfirm;

  useEffect(() => {
    if (!current) return;
    setMarkedIds((prev) => {
      const next = new Set(prev);
      if (current.needsReview) next.add(current.itemId);
      else next.delete(current.itemId);
      return [...next];
    });
  }, [current, current?.itemId, current?.needsReview]);

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
    const onPop = (event: PopStateEvent) => {
      if (overlayOpenRef.current && !historyStateHasFlashcardsOverlay(event.state)) {
        setEndConfirm(false);
        return;
      }
      const nextRoute = parseMobileFlashcardsRoute();
      const stillThisRound =
        nextRoute?.kind === 'study' && nextRoute.roundId === props.roundId;
      if (stillThisRound) return;
      void pauseIfActive(controller);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [controller, props.roundId]);

  const leave = useCallback(() => {
    void pauseThenLeave(controller, props.onLeave);
  }, [controller, props.onLeave]);

  const openEndConfirm = (): void => {
    setEndConfirm(true);
    pushMobileFlashcardsOverlay('end-confirm');
  };

  const closeEndConfirm = (): void => {
    setEndConfirm(false);
    popMobileFlashcardsOverlay();
  };

  const confirmEnd = (): void => {
    setEndConfirm(false);
    overlayOpenRef.current = false;
    popMobileFlashcardsOverlay();
    void controller?.end();
  };

  const startNewRound = useCallback(async () => {
    if (!controller || !snapshot) return;
    await controller.start({
      mode: snapshot.round.mode,
      scope: snapshot.round.scope,
      resumeExisting: false,
    });
    const nextId = controller.getViewModel().snapshot?.round.roundId;
    if (nextId && nextId !== props.roundId) {
      navigateMobileFlashcardsRoute({ kind: 'study', roundId: nextId }, 'replace');
    }
  }, [controller, props.roundId, snapshot]);

  const reinforce = useCallback(() => {
    const roundId = snapshot?.round.roundId;
    if (!controller || !roundId || markedIds.length === 0) return;
    void controller.start({
      mode: 'sequence',
      scope: { kind: 'selection', parentRoundId: roundId, itemIds: markedIds },
      resumeExisting: false,
    }).then(() => {
      const nextId = controller.getViewModel().snapshot?.round.roundId;
      if (nextId) navigateMobileFlashcardsRoute({ kind: 'study', roundId: nextId }, 'replace');
    });
  }, [controller, markedIds, snapshot?.round.roundId]);

  const mode = snapshot?.round.mode ?? 'sequence';

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
        closeEndConfirm();
        return;
      }
      if (action.type === 'leave') {
        leave();
        return;
      }
      if (!controller) return;
      if (action.type === 'flip') void controller.flip();
      if (action.type === 'next') void controller.next();
      if (action.type === 'rate') void controller.rate(action.rating);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, endConfirm, leave, mode, view.phase]);

  const backLabel = props.returnSource === 'chat' ? copy.backChat : copy.backCatalog;

  return (
    <div className="mobile-flashcards-page mobile-flashcards-study" data-testid="flashcards-study-page">
      <header className="mobile-flashcards-header">
        <button
          type="button"
          className="mobile-flashcards-back"
          data-testid="flashcards-study-back-btn"
          onClick={() => {
            if (endConfirm) {
              closeEndConfirm();
              return;
            }
            leave();
          }}
          aria-label={backLabel}
        >
          <IconBack size={20} />
          <span>{backLabel}</span>
        </button>
        <h1 className="mobile-flashcards-title">
          {mode === 'scheduled' ? copy.scheduledTitle : copy.sequenceTitle}
        </h1>
        <span className="mobile-flashcards-header-spacer" />
      </header>
      {renderStudyBody({
        view,
        controller,
        hold,
        facesConcealed,
        endConfirm,
        markedIds,
        onLeave: leave,
        onNewRound: () => void startNewRound(),
        onOpenEnd: openEndConfirm,
        onCloseEnd: closeEndConfirm,
        onConfirmEnd: confirmEnd,
        ...(markedIds.length > 0 ? { onReinforce: reinforce } : {}),
      })}
    </div>
  );
}

function renderStudyBody(input: {
  view: FlashcardStudyViewModel;
  controller: FlashcardStudyController | null;
  hold: FaceHold;
  facesConcealed: boolean;
  endConfirm: boolean;
  markedIds: string[];
  onLeave: () => void;
  onNewRound: () => void;
  onReinforce?: () => void;
  onOpenEnd: () => void;
  onCloseEnd: () => void;
  onConfirmEnd: () => void;
}): ReactElement {
  const { view, controller, hold } = input;
  const snapshot = view.snapshot;
  const status = snapshot?.round.status;
  const completed = view.phase === 'completed' || status === 'completed' || status === 'ended';
  const paused = view.phase === 'paused' || input.facesConcealed;
  const counts = snapshot?.counts;
  const displayCurrent = hold.current;
  const hasNext = Boolean(snapshot?.nextShell);
  const busy =
    view.phase === 'saving' ||
    view.phase === 'transitioning' ||
    view.phase === 'pending-confirmation';
  const mode = snapshot?.round.mode ?? 'sequence';

  if (view.phase === 'loading' && !snapshot) {
    return (
      <div className="mobile-flashcards-loading">
        <Spinner label={copy.saving} />
      </div>
    );
  }

  if (view.phase === 'error' && view.error?.code === 'host-too-old') {
    return (
      <div className="mobile-flashcards-status">
        <Notice tone="error" testId="flashcards-study-host-old" title={copy.hostTooOld}>
          {copy.hostTooOldBody}
        </Notice>
        <Button variant="secondary" onClick={input.onLeave}>
          {copy.backChat}
        </Button>
      </div>
    );
  }

  if (view.phase === 'error' && !snapshot) {
    return (
      <div className="mobile-flashcards-status">
        <Notice tone="error" testId="flashcards-study-missing" title={copy.roundMissing}>
          {view.error?.message || copy.roundMissingBody}
        </Notice>
        <Button variant="secondary" onClick={input.onLeave}>
          {copy.backCatalog}
        </Button>
      </div>
    );
  }

  if (completed) {
    return renderCompleted(input);
  }

  const underShell = blankIncomingUnderShell(hold.tearing, snapshot?.current !== undefined, hasNext);
  const save = saveKind(view);
  const progressTotal = counts?.total ?? 0;
  const progressIndex =
    progressTotal === 0 ? 0 : Math.min(progressTotal, (counts?.processed ?? 0) + (displayCurrent ? 1 : 0));
  const progressPercent = progressTotal === 0 ? 0 : Math.round((progressIndex / progressTotal) * 100);

  return (
    <div className="vault-study-page">
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
        <Notice
          tone="warning"
          testId="flashcards-study-readonly"
          action={
            <Button variant="secondary" size="compact" onClick={() => void controller?.claim()}>
              {copy.claim}
            </Button>
          }
        >
          {copy.readOnly}
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
                  <IconRevert size={13} />
                  <span>{copy.undo}</span>
                </Button>
              ) : null}
              {paused && !input.facesConcealed ? (
                <Button
                  variant="secondary"
                  size="compact"
                  data-testid="flashcards-study-resume"
                  onClick={() => void controller?.resume()}
                >
                  <IconPlay size={13} />
                  <span>{copy.resume}</span>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="compact"
                  data-testid="flashcards-study-pause"
                  disabled={busy || view.readOnly || input.facesConcealed}
                  onClick={() => void controller?.pause()}
                >
                  <IconPause size={13} />
                  <span>{copy.pause}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="compact"
                data-testid="flashcards-study-end"
                disabled={view.readOnly}
                onClick={input.onOpenEnd}
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
            renderStudyFace(displayCurrent, copy, {
              tearing: hold.tearing,
              revealed: hold.revealed,
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
              {paused && !input.facesConcealed ? (
                <Button variant="primary" onClick={() => void controller?.resume()}>
                  <IconPlay size={14} />
                  <span>{copy.resume}</span>
                </Button>
              ) : null}
            </footer>
          ) : (
            renderStudyActions({
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

      {input.endConfirm ? (
        <div className="mobile-flashcards-overlay" data-testid="flashcards-study-end-confirm" role="dialog" aria-modal="true">
          <div className="mobile-flashcards-overlay-card">
            <h3>{copy.endRoundTitle}</h3>
            <p>{copy.endRoundBody}</p>
            <div className="fcws-dialog-footer">
              <Button variant="ghost" onClick={input.onCloseEnd}>
                {copy.cancel}
              </Button>
              <Button variant="primary" data-testid="flashcards-study-end-confirm-btn" onClick={input.onConfirmEnd}>
                {copy.endRoundConfirm}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderCompleted(input: {
  view: FlashcardStudyViewModel;
  markedIds: string[];
  onLeave: () => void;
  onNewRound: () => void;
  onReinforce?: () => void;
}): ReactElement {
  const snapshot = input.view.snapshot;
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
      : copy.sequenceCompleted(processed, input.markedIds.length);
  return (
    <TearDeckSurface
      completed
      completedContent={
        <>
          <div className="fcws-tear-completed-icon">
            <IconCheck size={32} />
          </div>
          <h3>{title}</h3>
          <p className="fcws-tear-completed-desc" data-testid="flashcards-study-completed-desc">
            {description}
          </p>
          <div className="fcws-tear-actions fcws-tear-completed-actions">
            <Button variant="primary" data-testid="flashcards-study-new-round" onClick={input.onNewRound}>
              <IconRefresh size={14} />
              <span>{copy.newRound}</span>
            </Button>
            {input.onReinforce && input.markedIds.length > 0 ? (
              <Button variant="secondary" data-testid="flashcards-study-reinforce" onClick={input.onReinforce}>
                {copy.reinforce}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={input.onLeave}>
              {copy.close}
            </Button>
          </div>
        </>
      }
    />
  );
}

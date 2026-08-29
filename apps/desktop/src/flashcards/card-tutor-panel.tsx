import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { FlashcardTutorFace } from '@piwin/contracts';
import { Button, Notice, Spinner } from '@piwin/ui-kit';
import { MarkdownView } from '../MarkdownView';
import { cardTutorCopy, tutorErrorMessage } from './card-tutor-copy';
import { useCardTutor } from './card-tutor-provider';

const SPINNER_DELAY_MS = 200;

export function CardTutorPanel(props: {
  locale: 'zh-CN' | 'en';
  itemId: string;
  face: FlashcardTutorFace;
  autoFocusHeading?: boolean;
}): ReactElement | null {
  const tutor = useCardTutor();
  const copy = cardTutorCopy(props.locale);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const active = tutor.state.itemId === props.itemId && tutor.state.status !== 'idle';
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!active || tutor.state.status !== 'loading') {
      setShowSpinner(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, tutor.state.status]);

  useEffect(() => {
    if (!active || !props.autoFocusHeading) return;
    headingRef.current?.focus();
  }, [active, props.autoFocusHeading, tutor.state.status]);

  if (!active) return null;

  const isHint = tutor.state.intent === 'hint' || props.face === 'front';
  const heading = isHint ? copy.panelHint : copy.panelExplain;
  const loadingLabel = isHint ? copy.loadingHint : copy.loadingExplain;
  const errorText = tutorErrorMessage(copy, tutor.state.error?.code);
  const liveMessage =
    tutor.state.status === 'ready'
      ? isHint
        ? copy.readyLiveHint
        : copy.readyLiveExplain
      : tutor.state.status === 'error'
        ? errorText
        : '';

  const modelUnavailable = tutor.state.error?.code === 'flashcard-selection-model-unavailable';

  return (
    <section className="fc-tutor-panel" data-testid="card-tutor-panel" data-status={tutor.state.status}>
      <h2 ref={headingRef} className="fc-tutor-heading" tabIndex={-1} data-testid="card-tutor-heading">
        {heading}
      </h2>
      <div className="fc-tutor-live" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>

      {tutor.state.status === 'loading' ? (
        <div className="fc-tutor-loading" data-testid="card-tutor-loading">
          {showSpinner ? <Spinner label={loadingLabel} testId="card-tutor-spinner" /> : null}
          <span>{loadingLabel}</span>
        </div>
      ) : null}

      {tutor.state.status === 'ready' && tutor.state.markdown ? (
        <div className="fc-tutor-ready" data-testid="card-tutor-ready">
          <MarkdownView
            text={tutor.state.markdown}
            renderingPhase="completed"
            showStreamingCaret={false}
            locale={props.locale}
            artifactPreviewEnabled={false}
          />
          {tutor.state.intent !== 'hint' ? (
            <div className="fc-tutor-actions">
              <Button variant="secondary" size="compact" onClick={() => void tutor.followUp('example')}>
                {copy.example}
              </Button>
              <Button variant="secondary" size="compact" onClick={() => void tutor.followUp('simplify')}>
                {copy.simplify}
              </Button>
              <Button variant="ghost" size="compact" disabled>
                {copy.makeCard}
              </Button>
              <Button variant="ghost" size="compact" onClick={tutor.close}>
                {copy.close}
              </Button>
            </div>
          ) : (
            <div className="fc-tutor-actions">
              <Button variant="ghost" size="compact" onClick={tutor.close}>
                {copy.close}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {tutor.state.status === 'error' ? (
        <Notice
          tone="error"
          testId="card-tutor-error"
          title={copy.errorGeneric}
          action={
            <div className="fc-tutor-actions">
              <Button variant="primary" size="compact" onClick={() => void tutor.retry()}>
                {copy.retry}
              </Button>
              <Button variant="ghost" size="compact" onClick={tutor.close}>
                {copy.close}
              </Button>
            </div>
          }
        >
          {errorText}
          {modelUnavailable ? (
            <div className="fc-tutor-fallback">
              <p>{copy.settingsFallback}</p>
              <p>{copy.chatFallback}</p>
            </div>
          ) : null}
        </Notice>
      ) : null}
    </section>
  );
}

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

/** Final-effective `fcws-tear-off` duration. Fallback if `animationend` is lost. */
export const FLASHCARD_TEAR_DURATION_MS = 200;

const TEAR_FALLBACK_SLACK_MS = 50;

export type TearDeckSurfaceProps = {
  completed?: boolean;
  toolbar?: ReactNode;
  actions?: ReactNode;
  current?: ReactNode;
  /** Next-card shell. Must not include readable question/answer. */
  underShell?: ReactNode;
  leaving?: ReactNode;
  completedContent?: ReactNode;
  /** `roundId + committedRevision`. Same id must not fire transition-end twice. */
  transitionId?: string;
  tearing?: boolean;
  onTransitionEnd?: (transitionId: string) => void;
  tearDurationMs?: number;
  className?: string;
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function joinClassNames(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

/**
 * Tear stage: current card, optional under-shell, optional leaving snapshot.
 * `animationend` only ends the visual transition — never a Host mutation.
 */
export function TearDeckSurface(props: TearDeckSurfaceProps): ReactElement {
  const stageRef = useRef<HTMLElement | null>(null);
  const endedIdsRef = useRef(new Set<string>());
  const tearDurationMs = props.tearDurationMs ?? FLASHCARD_TEAR_DURATION_MS;
  const transitionId = props.transitionId;
  const tearing = props.tearing === true;
  const onTransitionEnd = props.onTransitionEnd;

  useEffect(() => {
    if (!tearing || transitionId === undefined || onTransitionEnd === undefined) {
      return;
    }
    if (endedIdsRef.current.has(transitionId)) {
      return;
    }

    const finish = (): void => {
      if (endedIdsRef.current.has(transitionId)) return;
      endedIdsRef.current.add(transitionId);
      onTransitionEnd(transitionId);
    };

    if (prefersReducedMotion()) {
      finish();
      return;
    }

    const stage = stageRef.current;
    const onAnimationEnd = (event: AnimationEvent): void => {
      if (event.target !== event.currentTarget && !(event.target instanceof Element)) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element) || !target.classList.contains('fcws-tear-card')) {
        return;
      }
      finish();
    };
    stage?.addEventListener('animationend', onAnimationEnd);
    const timer = window.setTimeout(finish, tearDurationMs + TEAR_FALLBACK_SLACK_MS);
    return () => {
      stage?.removeEventListener('animationend', onAnimationEnd);
      window.clearTimeout(timer);
    };
  }, [onTransitionEnd, tearDurationMs, tearing, transitionId]);

  const rootClass = joinClassNames(
    'fcws-tear',
    props.completed && 'fcws-tear-completed',
    props.className,
  );

  if (props.completed) {
    return (
      <div className={rootClass} data-testid="flashcards-tear">
        {props.completedContent}
      </div>
    );
  }

  return (
    <div className={rootClass} data-testid="flashcards-tear">
      {props.toolbar}
      <main
        className={joinClassNames('fcws-tear-stage', props.underShell !== undefined && 'has-under-shell')}
        ref={stageRef}
      >
        {props.underShell ? <div className="fcws-tear-under">{props.underShell}</div> : null}
        {props.leaving}
        {props.current}
      </main>
      {props.actions}
    </div>
  );
}

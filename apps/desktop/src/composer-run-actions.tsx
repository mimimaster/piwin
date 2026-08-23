/**
 * One Stop control while a run is live. Click sends session/abort immediately.
 * The button greys only to ignore a second click until Host answers.
 */
import type { ReactElement } from 'react';
import { IconSend, IconStop } from './shell-icons';

export type ComposerRunActionCopy = {
  stop: string;
  stopping: string;
  continueRun?: string;
};

/** Shown only when Host already projected a paused checkpoint (not the live interrupt). */
export function ComposerPausedActions(props: {
  copy: ComposerRunActionCopy;
  activeSessionId: string | null;
  onResume?: () => void;
  onAbort: () => void;
}): ReactElement {
  return (
    <div className="composer-v2-action-group">
      <button
        type="button"
        className="composer-v2-send-btn"
        data-testid="resume-run-btn"
        disabled={!props.activeSessionId || !props.onResume}
        onClick={props.onResume}
        aria-label={props.copy.continueRun ?? 'Resume'}
        title={props.copy.continueRun ?? 'Resume'}
      >
        <IconSend />
      </button>
      <button
        type="button"
        className="composer-v2-stop-btn is-running"
        data-testid="discard-pause-btn"
        data-action="stop"
        disabled={!props.activeSessionId}
        onClick={props.onAbort}
        aria-label={props.copy.stop}
        title={props.copy.stop}
      >
        <IconStop />
      </button>
    </div>
  );
}

export function ComposerStreamingInterrupt(props: {
  copy: ComposerRunActionCopy;
  activeSessionId: string | null;
  runPhase: 'idle' | 'streaming' | 'aborting';
  onAbort: () => void;
}): ReactElement {
  const isAborting = props.runPhase === 'aborting';
  return (
    <button
      type="button"
      className="composer-v2-stop-btn is-running"
      data-testid="stop-btn"
      data-action="stop"
      disabled={!props.activeSessionId || isAborting}
      onClick={props.onAbort}
      aria-label={isAborting ? props.copy.stopping : props.copy.stop}
      title={isAborting ? props.copy.stopping : props.copy.stop}
    >
      <IconStop />
    </button>
  );
}

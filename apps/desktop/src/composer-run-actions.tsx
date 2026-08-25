/** Run controls shared by the live and checkpoint-resting composer states. */
import type { ReactElement } from 'react';
import { IconPause, IconSend, IconStop } from './shell-icons';

export type ComposerRunActionCopy = {
  pause: string;
  pausing: string;
  stop: string;
  stopping: string;
  continueRun: string;
  discardPause: string;
};

/** Shown only when Host already projected a paused checkpoint (not the live interrupt). */
export function ComposerPausedActions(props: {
  copy: ComposerRunActionCopy;
  activeSessionId: string | null;
  onResume?: () => void;
  onAbort: () => void;
  mutationsEnabled?: boolean;
}): ReactElement {
  return (
    <div className="composer-v2-action-group">
      <button
        type="button"
        className="composer-v2-send-btn"
        data-testid="resume-run-btn"
        disabled={!props.activeSessionId || !props.onResume || props.mutationsEnabled === false}
        onClick={props.onResume}
        aria-label={props.copy.continueRun}
        title={props.copy.continueRun}
      >
        <IconSend />
      </button>
      <button
        type="button"
        className="composer-v2-stop-btn is-running"
        data-testid="discard-pause-btn"
        data-action="stop"
        disabled={!props.activeSessionId || props.mutationsEnabled === false}
        onClick={props.onAbort}
        aria-label={props.copy.discardPause}
        title={props.copy.discardPause}
      >
        <IconStop />
      </button>
    </div>
  );
}

export function ComposerStreamingPause(props: {
  copy: ComposerRunActionCopy;
  activeSessionId: string | null;
  runPhase: 'idle' | 'streaming' | 'pausing' | 'aborting';
  onPause: () => void;
  mutationsEnabled?: boolean;
}): ReactElement {
  const isPausing = props.runPhase === 'pausing';
  const isAborting = props.runPhase === 'aborting';
  const isControlPending = isPausing || isAborting;
  const label = isAborting
    ? props.copy.stopping
    : isPausing
      ? props.copy.pausing
      : props.copy.pause;
  return (
    <button
      type="button"
      className="composer-v2-stop-btn is-running is-pause"
      data-testid="pause-btn"
      data-action="pause"
      disabled={!props.activeSessionId || isControlPending || props.mutationsEnabled === false}
      onClick={props.onPause}
      aria-label={label}
      title={label}
    >
      <IconPause />
    </button>
  );
}

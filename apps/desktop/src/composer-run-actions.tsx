/**
 * Composer action slot: exactly one circular control.
 *
 * Idle Send → live Pause (`session/pause`) → paused Continue.
 * A real draft while live or paused uses ordinary Send.
 * Paused empty, or a continue-only utterance (`继续` / `continue`), resumes.
 * Live Send admits a Host queued turn. Cmd/Ctrl+Enter still steers.
 */
import type { ReactElement } from 'react';
import { IconPause, IconRefresh, IconSend, IconStop } from './shell-icons';

export type ComposerActionSlotCopy = {
  send: string;
  sendShortcut: string;
  pause: string;
  pausing: string;
  stop: string;
  stopping: string;
  continueRun: string;
  attachmentRetryOnly: string;
  queueFollowUp: string;
  queueFollowUpHint: string;
};

export type ComposerActionSlotProps = {
  copy: ComposerActionSlotCopy;
  activeSessionId: string | null;
  runPhase: 'idle' | 'streaming' | 'pausing' | 'aborting';
  isStreamingRun: boolean;
  isPaused: boolean;
  hasContent: boolean;
  /** Paused + continue-only text (no attachments): show Continue, not Send. */
  isPauseContinueDraft?: boolean;
  onlyFailedAttachments: boolean;
  mutationsEnabled?: boolean;
  isExtensionUiActive: boolean;
  onSend: () => void;
  onPause: () => void;
  onResume?: () => void;
  onAbort?: () => void;
  /** Narrow columns: streaming is Stop, not Pause / queued Send. */
  embedded?: boolean;
  stopOnly?: boolean;
};

function mutationsOff(props: ComposerActionSlotProps): boolean {
  return props.mutationsEnabled === false;
}

function isLiveControlPending(props: ComposerActionSlotProps): boolean {
  return props.runPhase === 'pausing' || props.runPhase === 'aborting';
}

function ComposerSendButton(props: ComposerActionSlotProps): ReactElement {
  const queued = props.isStreamingRun;
  return (
    <button
      type="button"
      className="composer-v2-send-btn"
      data-testid="send-btn"
      disabled={!props.hasContent || mutationsOff(props)}
      onClick={props.onSend}
      aria-label={queued ? props.copy.queueFollowUp : props.copy.send}
      title={queued ? props.copy.queueFollowUpHint : props.copy.sendShortcut}
    >
      <IconSend />
    </button>
  );
}

function ComposerRetryButton(props: ComposerActionSlotProps): ReactElement {
  return (
    <button
      type="button"
      className="composer-v2-send-btn is-retry"
      data-testid="send-btn"
      onClick={props.onSend}
      aria-label={props.copy.attachmentRetryOnly}
      title={props.copy.attachmentRetryOnly}
    >
      <IconRefresh />
    </button>
  );
}

function ComposerContinueButton(props: ComposerActionSlotProps): ReactElement {
  return (
    <button
      type="button"
      className="composer-v2-send-btn"
      data-testid="resume-run-btn"
      disabled={!props.activeSessionId || !props.onResume || mutationsOff(props)}
      onClick={props.onResume}
      aria-label={props.copy.continueRun}
      title={props.copy.continueRun}
    >
      <IconSend />
    </button>
  );
}

function ComposerStopButton(props: ComposerActionSlotProps): ReactElement {
  const isAborting = props.runPhase === 'aborting';
  const label = isAborting ? props.copy.stopping : props.copy.stop;
  return (
    <button
      type="button"
      className="composer-v2-stop-btn is-running"
      data-testid="stop-btn"
      disabled={isAborting}
      onClick={() => props.onAbort?.()}
      aria-label={label}
      title={label}
    >
      <IconStop />
    </button>
  );
}

function ComposerPauseButton(props: ComposerActionSlotProps): ReactElement {
  const isPausing = props.runPhase === 'pausing';
  const isAborting = props.runPhase === 'aborting';
  const isControlPending = isLiveControlPending(props);
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
      disabled={!props.activeSessionId || isControlPending || mutationsOff(props)}
      onClick={props.onPause}
      aria-label={label}
      title={label}
    >
      <IconPause />
    </button>
  );
}

function renderPrimaryCircle(props: ComposerActionSlotProps): ReactElement {
  if (props.embedded === true && props.isStreamingRun) {
    return <ComposerStopButton {...props} />;
  }
  if (props.stopOnly === true && props.isStreamingRun) {
    return props.hasContent ? <ComposerSendButton {...props} /> : <ComposerStopButton {...props} />;
  }
  if (props.isStreamingRun) {
    // Pause in flight, or Extension UI owning the textarea, keep Pause.
    if (isLiveControlPending(props) || props.isExtensionUiActive) {
      return <ComposerPauseButton {...props} />;
    }
    if (props.hasContent) {
      return <ComposerSendButton {...props} />;
    }
    return <ComposerPauseButton {...props} />;
  }
  if (props.isPaused && (!props.hasContent || props.isPauseContinueDraft === true)) {
    return <ComposerContinueButton {...props} />;
  }
  if (props.onlyFailedAttachments) {
    return <ComposerRetryButton {...props} />;
  }
  return <ComposerSendButton {...props} />;
}

export function ComposerActionSlot(props: ComposerActionSlotProps): ReactElement {
  return <div className="composer-v2-action-slot">{renderPrimaryCircle(props)}</div>;
}

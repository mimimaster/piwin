/**
 * Composer action slot: exactly one circular control.
 *
 * Idle Send → live Pause (`session/pause`) → paused Continue.
 * A draft while live or paused uses ordinary Send; only empty Continue resumes.
 * Live Send admits a Host queued turn. Cmd/Ctrl+Enter still steers.
 */
import type { ReactElement } from 'react';
import { IconPause, IconRefresh, IconSend } from './shell-icons';

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
  onlyFailedAttachments: boolean;
  mutationsEnabled?: boolean;
  isExtensionUiActive: boolean;
  onSend: () => void;
  onPause: () => void;
  onResume?: () => void;
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
  if (props.isPaused && !props.hasContent) {
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

/**
 * Structured reasons for cancelling a foreground run.
 *
 * Passed via AbortController.abort(reason) so gated tools (bash, etc.) can
 * surface a model-readable explanation instead of a bare "Command aborted".
 */
export type RunAbortCode =
  | 'user-stop'
  | 'pause-requested'
  | 'superseded-by-new-prompt'
  | 'host-shutdown'
  | 'unknown';

export type RunAbortReason = {
  code: RunAbortCode;
  /** Human + model readable explanation (no secrets). */
  message: string;
};

export function createUserStopAbortReason(): RunAbortReason {
  return {
    code: 'user-stop',
    message:
      'The user stopped this run (Stop). In-flight tools were cancelled before they finished. ' +
      'Do not treat cancelled tool results as successful completion; re-run tools if you still need their output.',
  };
}

export function createPauseRequestedAbortReason(): RunAbortReason {
  return {
    code: 'pause-requested',
    message:
      'The user paused this run. In-flight operations were stopped at the current cancellation boundary. ' +
      'A resumable checkpoint was saved; continue from the checkpoint instead of treating this as completed work.',
  };
}

export function createSupersededByNewPromptAbortReason(): RunAbortReason {
  return {
    code: 'superseded-by-new-prompt',
    message:
      'A newer user message started, so this run was interrupted. In-flight tools were cancelled before they finished. ' +
      'Do not treat cancelled tool results as successful completion; re-run tools if the new request still needs them.',
  };
}

export function createHostShutdownAbortReason(): RunAbortReason {
  return {
    code: 'host-shutdown',
    message: 'The host is shutting down; this run was cancelled.',
  };
}

export function isRunAbortReason(value: unknown): value is RunAbortReason {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  const code = record.code;
  const message = record.message;
  if (typeof message !== 'string' || message.trim() === '') {
    return false;
  }
  return (
    code === 'user-stop' ||
    code === 'pause-requested' ||
    code === 'superseded-by-new-prompt' ||
    code === 'host-shutdown' ||
    code === 'unknown'
  );
}

export function isPauseRequestedAbortReason(value: unknown): value is RunAbortReason {
  return isRunAbortReason(value) && value.code === 'pause-requested';
}

/**
 * Normalize AbortSignal.reason (or any thrown value) into a single sentence
 * suitable for tool errors shown to the model and Desktop.
 */
export function formatRunAbortReason(reason: unknown): string {
  if (isRunAbortReason(reason)) {
    return reason.message;
  }
  if (typeof reason === 'string' && reason.trim() !== '') {
    return reason.trim();
  }
  if (reason instanceof Error && reason.message.trim() !== '') {
    // DOMException AbortError often has a generic message; keep it short.
    if (reason.name === 'AbortError') {
      return 'The run was cancelled before the command finished.';
    }
    return reason.message.trim();
  }
  return (
    'The run was cancelled before the command finished. ' +
    'Do not treat cancelled tool results as successful completion; re-run tools if you still need their output.'
  );
}

/** True when tool/output text looks like a cancelled bash/tool result. */
export function looksLikeCancelledToolOutput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.includes('command aborted') ||
    normalized.includes('was interrupted') ||
    normalized.includes('was cancelled') ||
    normalized.includes('user stopped this run') ||
    normalized.includes('superseded by a newer')
  );
}

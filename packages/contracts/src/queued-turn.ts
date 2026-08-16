import type { PromptInput } from './host.js';

/** Durable normal prompt waiting for Host admission after a foreground Run. */
export type QueuedTurnStatus = 'pending' | 'starting' | 'started' | 'cancelled' | 'failed';

export type QueuedTurnMode = 'next' | 'replace';

export type QueuedTurnTerminalReason =
  | 'user-cancelled'
  | 'run-replaced'
  | 'session-closed'
  | 'prompt-rejected'
  | 'preparation-failed'
  | 'media-unavailable'
  | 'runtime-unavailable'
  | 'replacement-target-mismatch'
  | 'replacement-cancellation-timeout'
  | 'host-restarted'
  | 'converted-to-intervention';

export type QueuedTurnRecord = {
  queuedTurnId: string;
  revision: number;
  sessionId: string;
  sequence: number;
  userMessageId: string;
  mode: QueuedTurnMode;
  status: QueuedTurnStatus;
  input: PromptInput;
  submittedAt: string;
  updatedAt: string;
  /** Set only for a Replace Run record. */
  replaceRunId?: string;
  /** Set once the frozen input is admitted as an ordinary Run. */
  startedRunId?: string;
  terminalReason?: QueuedTurnTerminalReason;
};

export const QUEUED_TURN_MAX_PENDING_PER_SESSION = 20;
export const QUEUED_TURN_MAX_TEXT_BYTES = 64 * 1024;
export const QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION = 512 * 1024;

export function isQueuedTurnTerminal(status: QueuedTurnStatus): boolean {
  return status === 'started' || status === 'cancelled' || status === 'failed';
}

export function isQueuedTurnPending(status: QueuedTurnStatus): boolean {
  return status === 'pending' || status === 'starting';
}

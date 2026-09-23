import type { MediaAttachmentRef } from './host.js';
import type { PromptContextRef } from './side-chat.js';
import type { SessionTranscriptMessage } from './session-transcript.js';

const PAUSE_CONTINUE_UTTERANCES = new Set([
  '继续',
  '接着',
  '接着做',
  '往下',
  '往下做',
  'continue',
  'keep going',
  'resume',
  'go on',
]);

/**
 * True when the user is asking to continue a paused turn, not start a new one.
 * Desktop maps these (text-only, no attachments) to checkpoint resume.
 */
export function isPauseContinueUtterance(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[!！。.?？~～]+$/g, '')
    .trim();
  return normalized.length === 0 || PAUSE_CONTINUE_UTTERANCES.has(normalized);
}

/** Durable, non-secret checkpoint used to continue an interrupted session turn. */
export type SessionPauseCheckpoint = {
  checkpointId: string;
  sessionId: string;
  sourceRunId: string;
  runtimeGenerationId?: string;
  createdAt: string;
  sourceUserMessageId?: string;
  lastAssistantMessageId?: string;
  transcriptRevision: number;
  /**
   * Subagent batch runs that were still running when the pause was requested.
   * Pausing cancels them; their worktrees and partial results stay retained.
   */
  interruptedSubagentRunIds?: string[];
  status: 'active' | 'consumed' | 'cleared';
  consumedAt?: string;
};

/** Fields supplied by Host when creating a checkpoint. */
export type SessionPauseCheckpointInput = Omit<
  SessionPauseCheckpoint,
  'checkpointId' | 'status' | 'consumedAt'
> & {
  checkpointId?: string;
};

/** Immediate acknowledgement for a pause control command. */
export type SessionPauseAcceptedData = {
  sessionId: string;
  runId?: string;
  state: 'pausing' | 'paused';
  checkpointId?: string;
  reason?: 'no-active-run' | 'run-mismatch' | 'active-descendants';
};

/** Immediate acknowledgement for a resume control command. */
export type SessionResumeRunAcceptedData = {
  sessionId: string;
  runId: string;
  checkpointId: string;
  acceptedAt: string;
};

/**
 * A prompt taken back after the user stopped it before the model produced
 * anything (Cursor-style). Clients put it back into their composer.
 */
export type SessionRetractedPrompt = {
  userMessageId: string;
  text: string;
  attachments?: MediaAttachmentRef[];
  contextRefs?: PromptContextRef[];
};

/**
 * `session/retract-paused-prompt` result: the paused checkpoint is cleared,
 * the prompt row and its empty reply are deleted, and the remaining tail is
 * returned in the requested projection (same shape as `session/truncate-from`).
 */
export type SessionRetractPausedPromptData = {
  sessionId: string;
  retracted: SessionRetractedPrompt;
  removedCount: number;
  remainingCount: number;
  messages?: SessionTranscriptMessage[];
};

/** Stable refusal codes for `session/retract-paused-prompt`. */
export const SESSION_RETRACT_REFUSALS = {
  /** No active pause checkpoint, or the client named a different one. */
  checkpointStale: 'retract-checkpoint-stale',
  /** The model already produced text, thinking, or tool calls this turn. */
  hasOutput: 'retract-has-output',
  /** The paused turn did not start from a plain user prompt. */
  notRetractable: 'retract-not-retractable',
} as const;

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

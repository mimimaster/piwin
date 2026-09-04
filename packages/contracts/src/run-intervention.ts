import type { PromptAttachment } from './browser.js';
import type { PromptContextRef } from './side-chat.js';

/** User-authored input accepted for one exact active Run. */
export type UserInstructionPayload = {
  text: string;
  attachments?: PromptAttachment[];
  contextRefs?: PromptContextRef[];
};

export type RunInterventionStatus =
  'pending' | 'applying' | 'applied' | 'cancelled' | 'expired' | 'failed' | 'uncertain';

export type RunInterventionTerminalReason =
  | 'run-ended'
  | 'run-pausing'
  | 'run-cancelling'
  | 'generation-replaced'
  | 'worker-crash'
  | 'backend-rejected'
  | 'preparation-failed'
  | 'application-outcome-unknown';

/** Durable Host-owned projection of an instruction addressed to one Run. */
export type RunInterventionRecord = {
  interventionId: string;
  revision: number;
  sessionId: string;
  runId: string;
  runtimeGenerationId: string;
  sequence: number;
  userMessageId: string;
  status: RunInterventionStatus;
  input: UserInstructionPayload;
  submittedAt: string;
  updatedAt: string;
  appliedAt?: string;
  appliedRequestOrdinal?: number;
  terminalReason?: RunInterventionTerminalReason;
};

/** Backend staging input. Prepared text is literal and must not be expanded by Pi. */
export type BackendRunIntervention = {
  interventionId: string;
  revision: number;
  sessionId: string;
  runId: string;
  runtimeGenerationId: string;
  sequence: number;
  text: string;
  /**
   * Native vision parts loaded by Host at arm time. Image bytes stay off the
   * durable intervention record; the staging queue holds them only for the
   * exact Run they were armed for.
   */
  images?: Array<{ dataBase64: string; mimeType: string }>;
};

/** Sibling backend lifecycle channel; never projected as an AgentEvent. */
export type BackendRunInterventionEvent =
  | {
      type: 'claim';
      interventionId: string;
      revision: number;
      runId: string;
      runtimeGenerationId: string;
    }
  | {
      type: 'applied';
      interventionId: string;
      revision: number;
      runId: string;
      runtimeGenerationId: string;
    }
  | {
      type: 'expired' | 'failed';
      interventionId: string;
      revision: number;
      runId: string;
      runtimeGenerationId: string;
      reason: string;
    };

/** A claim listener must durably accept the transition before injection. */
export type BackendRunInterventionEventResult = { accepted: boolean };

export const RUN_INTERVENTION_MAX_PENDING_PER_RUN = 10;
export const RUN_INTERVENTION_MAX_TEXT_BYTES = 64 * 1024;
export const RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN = 256 * 1024;

export function isRunInterventionTerminal(status: RunInterventionStatus): boolean {
  return (
    status === 'applied' ||
    status === 'cancelled' ||
    status === 'expired' ||
    status === 'failed' ||
    status === 'uncertain'
  );
}

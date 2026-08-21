/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import type { DatabaseSync } from 'node:sqlite';
import type {
  MediaAttachmentRef,
  ModelRef,
  QueuedTurnMode,
  QueuedTurnRecord,
  QueuedTurnStatus,
  QueuedTurnTerminalReason,
  RunInterventionRecord,
  RunInterventionStatus,
  RunInterventionTerminalReason,
  SessionPauseCheckpoint,
  SessionToolCardView,
  SessionTranscriptMessage,
  UserInstructionPayload,
} from '@piwin/contracts';
import type { TranscriptStoreMessageInput } from './transcript-store.js';

export type MessageRow = {
  sequence: number;
  id: string;
  runtime_generation_id: string;
  backend_message_id: string;
  role: string;
  text: string;
  thinking: string | null;
  status: string;
  created_at: string;
  run_id: string | null;
  model_json: string | null;
  attachments_json: string | null;
  context_refs_json: string | null;
  tools_json: string | null;
  metadata_json: string | null;
};

export type PauseCheckpointRow = {
  checkpoint_id: string;
  session_id: string;
  source_run_id: string;
  runtime_generation_id: string | null;
  created_at: string;
  source_user_message_id: string | null;
  last_assistant_message_id: string | null;
  transcript_revision: number;
  status: string;
  consumed_at: string | null;
};

export type RunInterventionRow = {
  intervention_id: string;
  revision: number;
  session_id: string;
  run_id: string;
  runtime_generation_id: string;
  sequence: number;
  user_message_id: string;
  status: string;
  input_json: string;
  prepared_text: string;
  fingerprint: string;
  submitted_at: string;
  updated_at: string;
  applied_at: string | null;
  applied_request_ordinal: number | null;
  terminal_reason: string | null;
};

export type QueuedTurnRow = {
  queued_turn_id: string;
  revision: number;
  session_id: string;
  sequence: number;
  user_message_id: string;
  mode: string;
  status: string;
  input_json: string;
  fingerprint: string;
  submitted_at: string;
  updated_at: string;
  replace_run_id: string | null;
  started_run_id: string | null;
  terminal_reason: string | null;
};

  export function rowToMessage(row: MessageRow): SessionTranscriptMessage {
    const message: SessionTranscriptMessage = {
      id: row.id,
      role: row.role as SessionTranscriptMessage['role'],
      text: row.text,
      createdAt: row.created_at,
      status: row.status as SessionTranscriptMessage['status'],
      runtimeGenerationId: row.runtime_generation_id,
    };
    if (row.thinking !== null) message.thinking = row.thinking;
    if (row.run_id !== null) message.runId = row.run_id;
    if (row.model_json !== null) message.model = JSON.parse(row.model_json) as ModelRef;
    if (row.attachments_json !== null) {
      message.attachments = JSON.parse(row.attachments_json) as MediaAttachmentRef[];
    }
    if (row.context_refs_json !== null) {
      const contextRefs = JSON.parse(
        row.context_refs_json,
      ) as SessionTranscriptMessage['contextRefs'];
      if (contextRefs !== undefined) {
        message.contextRefs = contextRefs;
      }
    }
    if (row.tools_json !== null) {
      message.tools = JSON.parse(row.tools_json) as SessionToolCardView[];
    }
    if (row.metadata_json !== null) {
      const metadata = JSON.parse(row.metadata_json) as NonNullable<
        TranscriptStoreMessageInput['metadata']
      >;
      if (metadata.phaseHistory !== undefined) message.phaseHistory = metadata.phaseHistory;
      if (metadata.startedAt !== undefined) message.startedAt = metadata.startedAt;
      if (metadata.endedAt !== undefined) message.endedAt = metadata.endedAt;
      if (metadata.thinkingStartedAt !== undefined) {
        message.thinkingStartedAt = metadata.thinkingStartedAt;
      }
      if (metadata.thinkingEndedAt !== undefined) {
        message.thinkingEndedAt = metadata.thinkingEndedAt;
      }
      if (metadata.outcome !== undefined) message.outcome = metadata.outcome;
      if (metadata.terminalMessage !== undefined)
        message.terminalMessage = metadata.terminalMessage;
      if (metadata.subagentActivity !== undefined) {
        message.subagentActivity = metadata.subagentActivity;
      }
      if (metadata.searchEvidence !== undefined) {
        message.searchEvidence = metadata.searchEvidence;
      }
      if (metadata.instructionDelivery !== undefined) {
        message.instructionDelivery = metadata.instructionDelivery;
      }
      if (metadata.docCardSequence !== undefined) {
        message.docCardSequence = metadata.docCardSequence;
      }
      if (metadata.replyWriter !== undefined) {
        message.replyWriter = metadata.replyWriter;
      }
      if (metadata.workspaceWrites !== undefined) {
        message.workspaceWrites = metadata.workspaceWrites;
      }
    }
    return message;
  }

  export function rowToRunIntervention(row: RunInterventionRow): RunInterventionRecord {
    const intervention: RunInterventionRecord = {
      interventionId: row.intervention_id,
      revision: row.revision,
      sessionId: row.session_id,
      runId: row.run_id,
      runtimeGenerationId: row.runtime_generation_id,
      sequence: row.sequence,
      userMessageId: row.user_message_id,
      status: row.status as RunInterventionStatus,
      input: JSON.parse(row.input_json) as UserInstructionPayload,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
    };
    if (row.applied_at !== null) intervention.appliedAt = row.applied_at;
    if (row.applied_request_ordinal !== null) {
      intervention.appliedRequestOrdinal = row.applied_request_ordinal;
    }
    if (row.terminal_reason !== null) {
      intervention.terminalReason = row.terminal_reason as RunInterventionTerminalReason;
    }
    return intervention;
  }

  export function rowToQueuedTurn(row: QueuedTurnRow): QueuedTurnRecord {
    const queuedTurn: QueuedTurnRecord = {
      queuedTurnId: row.queued_turn_id,
      revision: row.revision,
      sessionId: row.session_id,
      sequence: row.sequence,
      userMessageId: row.user_message_id,
      mode: row.mode as QueuedTurnMode,
      status: row.status as QueuedTurnStatus,
      input: JSON.parse(row.input_json) as import('@piwin/contracts').PromptInput,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
    };
    if (row.replace_run_id !== null) queuedTurn.replaceRunId = row.replace_run_id;
    if (row.started_run_id !== null) queuedTurn.startedRunId = row.started_run_id;
    if (row.terminal_reason !== null) {
      queuedTurn.terminalReason = row.terminal_reason as QueuedTurnTerminalReason;
    }
    return queuedTurn;
  }

  export function instructionMetadata(
    row: Pick<RunInterventionRecord, 'interventionId' | 'revision' | 'runId' | 'status'>,
  ): NonNullable<TranscriptStoreMessageInput['metadata']> {
    return {
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: row.interventionId,
        status: row.status,
        targetRunId: row.runId,
        revision: row.revision,
      },
    };
  }

  export function queuedTurnMetadata(
    row: Pick<QueuedTurnRecord, 'queuedTurnId' | 'revision' | 'status' | 'replaceRunId'> & {
      startedRunId?: string;
    },
  ): NonNullable<TranscriptStoreMessageInput['metadata']> {
    const targetRunId = row.startedRunId ?? row.replaceRunId;
    return {
      instructionDelivery: {
        kind: 'queued-turn',
        instructionId: row.queuedTurnId,
        status: row.status,
        ...(targetRunId === undefined ? {} : { targetRunId }),
        revision: row.revision,
      },
    };
  }

  export function rowToPauseCheckpoint(row: PauseCheckpointRow): SessionPauseCheckpoint {
    const checkpoint: SessionPauseCheckpoint = {
      checkpointId: row.checkpoint_id,
      sessionId: row.session_id,
      sourceRunId: row.source_run_id,
      createdAt: row.created_at,
      transcriptRevision: row.transcript_revision,
      status: row.status as SessionPauseCheckpoint['status'],
    };
    if (row.runtime_generation_id !== null) {
      checkpoint.runtimeGenerationId = row.runtime_generation_id;
    }
    if (row.source_user_message_id !== null) {
      checkpoint.sourceUserMessageId = row.source_user_message_id;
    }
    if (row.last_assistant_message_id !== null) {
      checkpoint.lastAssistantMessageId = row.last_assistant_message_id;
    }
    if (row.consumed_at !== null) {
      checkpoint.consumedAt = row.consumed_at;
    }
    return checkpoint;
  }

/**
 * Whole-table row count. Deliberately global (not path-scoped): legacy-import
 * verification compares against the physical table, branches included.
 */
export function countRows(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
    count: number;
  };
  return row.count;
}

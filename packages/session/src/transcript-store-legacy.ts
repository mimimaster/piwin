/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  SessionTranscriptDocument,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { LEGACY_IMPORT_GENERATION } from '@piwin/contracts';
import type { TranscriptStoreCore, SessionTranscriptStore, TranscriptStoreMessageInput } from './transcript-store.js';
import { rollback } from './sqlite-errors.js';
import { isIndexedUserMessage } from './transcript-store-bounds.js';
import { stableSerialize } from './stable-serialize.js';
import { countRows, type MessageRow } from './transcript-store-rows.js';

export function computeLegacyTranscriptDigest(document: SessionTranscriptDocument): string {
  return digestStoredMessages(
    document.sessionId,
    document.messages.map((message) => legacyMessageToInput(message)),
  );
}

function legacyMessageToInput(message: SessionTranscriptMessage): TranscriptStoreMessageInput {
  const hasMetadata =
    message.phaseHistory !== undefined ||
    message.startedAt !== undefined ||
    message.endedAt !== undefined ||
    message.thinkingStartedAt !== undefined ||
    message.thinkingEndedAt !== undefined ||
    message.outcome !== undefined ||
    message.terminalMessage !== undefined ||
    message.failure !== undefined ||
    message.subagentActivity !== undefined ||
    message.searchEvidence !== undefined ||
    message.docCardSequence !== undefined;
  return {
    id: message.id,
    runtimeGenerationId: LEGACY_IMPORT_GENERATION,
    backendMessageId: message.id,
    role: message.role,
    text: message.text,
    status: message.status,
    createdAt: message.createdAt,
    ...(message.thinking !== undefined ? { thinking: message.thinking } : {}),
    ...(message.runId !== undefined ? { runId: message.runId } : {}),
    ...(message.model !== undefined ? { model: message.model } : {}),
    ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
    ...(message.contextRefs !== undefined ? { contextRefs: message.contextRefs } : {}),
    ...(message.tools !== undefined ? { tools: message.tools } : {}),
    ...(hasMetadata
      ? {
          metadata: {
            ...(message.phaseHistory !== undefined ? { phaseHistory: message.phaseHistory } : {}),
            ...(message.startedAt !== undefined ? { startedAt: message.startedAt } : {}),
            ...(message.endedAt !== undefined ? { endedAt: message.endedAt } : {}),
            ...(message.thinkingStartedAt !== undefined
              ? { thinkingStartedAt: message.thinkingStartedAt }
              : {}),
            ...(message.thinkingEndedAt !== undefined
              ? { thinkingEndedAt: message.thinkingEndedAt }
              : {}),
            ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
            ...(message.terminalMessage !== undefined
              ? { terminalMessage: message.terminalMessage }
              : {}),
            ...(message.failure !== undefined ? { failure: message.failure } : {}),
            ...(message.subagentActivity !== undefined
              ? { subagentActivity: message.subagentActivity }
              : {}),
            ...(message.searchEvidence !== undefined
              ? { searchEvidence: message.searchEvidence }
              : {}),
            ...(message.docCardSequence !== undefined
              ? { docCardSequence: message.docCardSequence }
              : {}),
          },
        }
      : {}),
  };
}

function digestStoredMessages(
  sessionId: string,
  messages: readonly TranscriptStoreMessageInput[],
): string {
  const hash = createHash('sha256');
  hash.update(sessionId);
  hash.update(`\u0000${messages.length}`);
  for (const message of messages) {
    hash.update('\u0000');
    hash.update(stableSerialize(canonicalInput(message)));
  }
  return hash.digest('hex');
}

function digestDatabaseRows(db: DatabaseSync, sessionId: string): string {
  const count = countRows(db);
  const hash = createHash('sha256');
  hash.update(sessionId);
  hash.update(`\u0000${count}`);
  const rows = db
    .prepare('SELECT * FROM transcript_message ORDER BY sequence ASC')
    .iterate() as IterableIterator<unknown>;
  for (const value of rows) {
    const row = value as MessageRow;
    hash.update('\u0000');
    hash.update(stableSerialize(canonicalRow(row)));
  }
  return hash.digest('hex');
}

function canonicalInput(input: TranscriptStoreMessageInput): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
    id: input.id,
    runtimeGenerationId: input.runtimeGenerationId,
    backendMessageId: input.backendMessageId,
    role: input.role,
    text: input.text,
    thinking: input.thinking ?? null,
    status: input.status,
    createdAt: input.createdAt,
    runId: input.runId ?? null,
    model: input.model ?? null,
    attachments: input.attachments ?? null,
    tools: input.tools ?? null,
    metadata: input.metadata ?? null,
  };
  // Omit absent contextRefs so legacy import digests stay stable.
  if (input.contextRefs !== undefined) {
    canonical.contextRefs = input.contextRefs;
  }
  return canonical;
}

function canonicalRow(row: MessageRow): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
    id: row.id,
    runtimeGenerationId: row.runtime_generation_id,
    backendMessageId: row.backend_message_id,
    role: row.role,
    text: row.text,
    thinking: row.thinking,
    status: row.status,
    createdAt: row.created_at,
    runId: row.run_id,
    model: parseStoredJson(row.model_json),
    attachments: parseStoredJson(row.attachments_json),
    tools: parseStoredJson(row.tools_json),
    metadata: parseStoredJson(row.metadata_json),
  };
  // Null storage means the field was never written; omit for digest parity.
  if (row.context_refs_json !== null) {
    canonical.contextRefs = parseStoredJson(row.context_refs_json);
  }
  return canonical;
}

function parseStoredJson(value: string | null): unknown {
  return value === null ? null : (JSON.parse(value) as unknown);
}

export function createTranscriptLegacyOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  'importLegacyDocument' | 'markAuthoritative' | 'isMigrated' | 'verifyLegacyDocument'
> {
  const { db, options, ensureOpen, bumpRevision, insertMessageRow } = core;

  return {
      async importLegacyDocument(document) {
        ensureOpen();
        if (document.sessionId !== options.sessionId) {
          throw new Error(
            `Legacy transcript session mismatch: expected ${options.sessionId}, got ${document.sessionId}`,
          );
        }
        const digest = computeLegacyTranscriptDigest(document);
        const meta = db
          .prepare('SELECT import_digest FROM transcript_meta WHERE session_id = ?')
          .get(options.sessionId) as { import_digest: string | null } | undefined;
        if (meta?.import_digest === digest) {
          // Idempotent only while the already-imported database still verifies.
          if (
            digestDatabaseRows(db, options.sessionId) !== digest ||
            countRows(db) !== document.messages.length
          ) {
            throw new Error('Previously imported transcript no longer matches its verified digest');
          }
          return { imported: 0 };
        }
        if (meta?.import_digest !== null && meta?.import_digest !== undefined) {
          // A different legacy document was already imported; never merge.
          return { imported: 0 };
        }
        const hasLiveRows = db
          .prepare(`SELECT 1 FROM transcript_message WHERE runtime_generation_id != ? LIMIT 1`)
          .get(LEGACY_IMPORT_GENERATION);
        if (hasLiveRows !== undefined) {
          // Live rows already exist; do not mix a legacy import underneath.
          return { imported: 0 };
        }
        const hasLegacyRows = db
          .prepare(`SELECT 1 FROM transcript_message WHERE runtime_generation_id = ? LIMIT 1`)
          .get(LEGACY_IMPORT_GENERATION);
        if (hasLegacyRows !== undefined && meta?.import_digest === null) {
          // Interrupted import left legacy rows without a verified digest.
          return { imported: 0 };
        }
        db.exec('BEGIN');
        try {
          let imported = 0;
          let importedUserMessages = 0;
          for (const message of document.messages) {
            insertMessageRow(legacyMessageToInput(message));
            imported += 1;
            if (isIndexedUserMessage(message.role, message.text)) {
              importedUserMessages += 1;
            }
          }
          const storedDigest = digestDatabaseRows(db, options.sessionId);
          if (storedDigest !== digest || countRows(db) !== document.messages.length) {
            throw new Error('Legacy transcript verification failed before authority selection');
          }
          db.prepare(
            `UPDATE transcript_meta
             SET import_digest = ?, authority_state = 'v2', updated_at = ?
             WHERE session_id = ?`,
          ).run(storedDigest, new Date().toISOString(), options.sessionId);
          bumpRevision(imported, importedUserMessages);
          db.exec('COMMIT');
          return { imported };
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },

      async markAuthoritative() {
        ensureOpen();
        db.prepare(
          `UPDATE transcript_meta SET authority_state = 'v2', updated_at = ? WHERE session_id = ?`,
        ).run(new Date().toISOString(), options.sessionId);
      },

      async isMigrated() {
        ensureOpen();
        const meta = db
          .prepare('SELECT authority_state FROM transcript_meta WHERE session_id = ?')
          .get(options.sessionId) as { authority_state: string } | undefined;
        return meta?.authority_state === 'v2';
      },

      async verifyLegacyDocument(document) {
        ensureOpen();
        const digest = computeLegacyTranscriptDigest(document);
        const meta = db
          .prepare('SELECT import_digest FROM transcript_meta WHERE session_id = ?')
          .get(options.sessionId) as { import_digest: string | null } | undefined;
        const storedDigest = meta?.import_digest ?? null;
        const databaseDigest = digestDatabaseRows(db, options.sessionId);
        return {
          matches:
            storedDigest === digest &&
            databaseDigest === digest &&
            countRows(db) === document.messages.length,
          digest,
          storedDigest,
        };
      }
  };
}

/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import type { SessionTranscriptMessage } from '@piwin/contracts';
import type { TranscriptStoreCore, SessionTranscriptStore } from './transcript-store.js';
import { isSqliteUniqueConstraint, rollback } from './sqlite-errors.js';
import { isIndexedUserMessage, validatePositiveBoundedInteger } from './transcript-store-bounds.js';
import { rowToMessage, type MessageRow } from './transcript-store-rows.js';

const MAX_TAIL_MESSAGES = 100;

export function createTranscriptMessagesOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  | 'appendMessage'
  | 'updateMessage'
  | 'listTail'
  | 'getMessage'
  | 'firstMessageByRole'
  | 'lastMessageByRole'
  | 'searchMessage'
  | 'hasLaterAssistant'
  | 'deleteMessage'
  | 'appendNativeEntries'
  | 'readNativeEntries'
  | 'count'
  | 'getRevision'
  | 'truncateFrom'
> {
  const { db, options, ensureOpen, bumpRevision, currentRevision, insertMessageRow } = core;

    function queryTail(limit: number, beforeSequence?: number): SessionTranscriptMessage[] {
      validatePositiveBoundedInteger(limit, 'Transcript tail limit', MAX_TAIL_MESSAGES);
      if (
        beforeSequence !== undefined &&
        (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0)
      ) {
        throw new RangeError('Transcript tail sequence cursor must be a positive safe integer');
      }
      const rows =
        beforeSequence === undefined
          ? db.prepare(`SELECT * FROM transcript_message ORDER BY sequence DESC LIMIT ?`).all(limit)
          : db
              .prepare(
                `SELECT * FROM transcript_message WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`,
              )
              .all(beforeSequence, limit);
      return (rows as unknown as MessageRow[]).reverse().map(rowToMessage);
    }

  return {
      async appendMessage(input) {
        ensureOpen();
        // Same-generation replay: idempotent no-op.
        const replay = db
          .prepare(
            `SELECT id FROM transcript_message WHERE runtime_generation_id = ? AND backend_message_id = ?`,
          )
          .get(input.runtimeGenerationId, input.backendMessageId) as { id: string } | undefined;
        if (replay !== undefined) {
          return replay.id === input.id
            ? { ok: true, replayed: true }
            : { ok: false, reason: 'provenance-collision' };
        }
        // A normalized id collision with different provenance never mutates
        // the older row.
        const idExists = db.prepare('SELECT 1 FROM transcript_message WHERE id = ?').get(input.id);
        if (idExists !== undefined) {
          return { ok: false, reason: 'provenance-collision' };
        }
        db.exec('BEGIN');
        try {
          insertMessageRow(input);
          bumpRevision(1, isIndexedUserMessage(input.role, input.text) ? 1 : 0);
          db.exec('COMMIT');
          return { ok: true };
        } catch (error) {
          rollback(db);
          if (isSqliteUniqueConstraint(error)) {
            return { ok: false, reason: 'provenance-collision' };
          }
          throw error;
        }
      },

      async updateMessage(id, patch) {
        ensureOpen();
        const assignments: string[] = [];
        const values: Array<string | number | null> = [];
        if (patch.text !== undefined) {
          assignments.push('text = ?');
          values.push(patch.text);
        }
        if (patch.status !== undefined) {
          assignments.push('status = ?');
          values.push(patch.status);
        }
        if (patch.thinking !== undefined) {
          assignments.push('thinking = ?');
          values.push(patch.thinking);
        }
        if (patch.tools !== undefined) {
          assignments.push('tools_json = ?');
          values.push(JSON.stringify(patch.tools));
        }
        if (patch.attachments !== undefined) {
          assignments.push('attachments_json = ?');
          values.push(JSON.stringify(patch.attachments));
        }
        if (patch.contextRefs !== undefined) {
          assignments.push('context_refs_json = ?');
          values.push(JSON.stringify(patch.contextRefs));
        }
        if (patch.metadata !== undefined) {
          assignments.push('metadata_json = ?');
          values.push(JSON.stringify(patch.metadata));
        }
        if (assignments.length === 0) {
          return false;
        }
        db.exec('BEGIN');
        try {
          const previous = db
            .prepare('SELECT role, text FROM transcript_message WHERE id = ?')
            .get(id) as { role: string; text: string } | undefined;
          const result = db
            .prepare(`UPDATE transcript_message SET ${assignments.join(', ')} WHERE id = ?`)
            .run(...values, id);
          if (result.changes > 0) {
            const userTextChanged =
              previous !== undefined &&
              patch.text !== undefined &&
              patch.text !== previous.text &&
              isIndexedUserMessage(previous.role, previous.text);
            const userTextBecameIndexed =
              previous !== undefined &&
              patch.text !== undefined &&
              patch.text !== previous.text &&
              previous.role === 'user' &&
              !isIndexedUserMessage(previous.role, previous.text) &&
              isIndexedUserMessage(previous.role, patch.text);
            bumpRevision(1, userTextChanged || userTextBecameIndexed ? 1 : 0);
          }
          db.exec('COMMIT');
          return result.changes > 0;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },

      async listTail(limit, beforeSequence) {
        ensureOpen();
        return queryTail(limit, beforeSequence);
      },

      async getMessage(id) {
        ensureOpen();
        const row = db.prepare('SELECT * FROM transcript_message WHERE id = ?').get(id) as unknown as
          MessageRow | undefined;
        return row === undefined ? undefined : rowToMessage(row);
      },

      async firstMessageByRole(role) {
        ensureOpen();
        const row = db
          .prepare('SELECT * FROM transcript_message WHERE role = ? ORDER BY sequence ASC LIMIT 1')
          .get(role) as unknown as MessageRow | undefined;
        return row === undefined ? undefined : rowToMessage(row);
      },

      async lastMessageByRole(role) {
        ensureOpen();
        const row = db
          .prepare('SELECT * FROM transcript_message WHERE role = ? ORDER BY sequence DESC LIMIT 1')
          .get(role) as unknown as MessageRow | undefined;
        return row === undefined ? undefined : rowToMessage(row);
      },

      async searchMessage(query) {
        ensureOpen();
        const normalized = query.trim().toLowerCase();
        if (normalized.length === 0 || normalized.length > 1_000) {
          return undefined;
        }
        const row = db
          .prepare(
            `SELECT sequence, id, runtime_generation_id, backend_message_id, role,
                    substr(text, 1, 8000) AS text, thinking, status, created_at,
                    run_id, model_json, attachments_json, tools_json, metadata_json
             FROM transcript_message
             WHERE role IN ('user', 'assistant') AND instr(lower(text), ?) > 0
             ORDER BY CASE role WHEN 'user' THEN 0 ELSE 1 END, sequence DESC
             LIMIT 1`,
          )
          .get(normalized) as unknown as MessageRow | undefined;
        return row === undefined ? undefined : rowToMessage(row);
      },

      async hasLaterAssistant(messageId, runId) {
        ensureOpen();
        const target = db
          .prepare('SELECT sequence FROM transcript_message WHERE id = ?')
          .get(messageId) as { sequence: number } | undefined;
        if (target === undefined) return false;
        const later =
          runId === undefined
            ? db
                .prepare(
                  `SELECT 1 FROM transcript_message
                 WHERE sequence > ? AND role = 'assistant' LIMIT 1`,
                )
                .get(target.sequence)
            : db
                .prepare(
                  `SELECT 1 FROM transcript_message
                 WHERE sequence > ? AND role = 'assistant' AND run_id = ? LIMIT 1`,
                )
                .get(target.sequence, runId);
        return later !== undefined;
      },

      async deleteMessage(id) {
        ensureOpen();
        db.exec('BEGIN');
        try {
          const previous = db
            .prepare('SELECT role, text FROM transcript_message WHERE id = ?')
            .get(id) as { role: string; text: string } | undefined;
          const result = db.prepare('DELETE FROM transcript_message WHERE id = ?').run(id);
          if (result.changes > 0) {
            db.prepare('DELETE FROM native_entry WHERE message_id = ?').run(id);
            bumpRevision(
              1,
              previous !== undefined && isIndexedUserMessage(previous.role, previous.text) ? 1 : 0,
            );
          }
          db.exec('COMMIT');
          return result.changes > 0;
        } catch (error) {
          rollback(db);
          throw error;
        }
      },

      async appendNativeEntries(messageId, entries) {
        ensureOpen();
        if (entries.length === 0) {
          return;
        }
        const insert = db.prepare(
          `INSERT OR IGNORE INTO native_entry(message_id, ordinal, payload, byte_length, truncated)
           VALUES (?, ?, ?, ?, ?)`,
        );
        db.exec('BEGIN');
        try {
          for (const { ordinal, entry } of entries) {
            insert.run(
              messageId,
              ordinal,
              entry.payload,
              entry.byteLength,
              entry.truncated === true ? 1 : 0,
            );
          }
          db.exec('COMMIT');
        } catch (error) {
          rollback(db);
          throw error;
        }
      },

      async readNativeEntries(messageId) {
        ensureOpen();
        const rows = db
          .prepare(
            `SELECT payload, byte_length, truncated FROM native_entry
             WHERE message_id = ? ORDER BY ordinal ASC`,
          )
          .all(messageId) as unknown as Array<{
          payload: string;
          byte_length: number;
          truncated: number;
        }>;
        return rows.map((row) => ({
          format: 'pi-message-v1' as const,
          payload: row.payload,
          byteLength: row.byte_length,
          ...(row.truncated === 1 ? { truncated: true as const } : {}),
        }));
      },
      async count() {
        ensureOpen();
        const row = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
          count: number;
        };
        return row.count;
      },

      async getRevision() {
        ensureOpen();
        return currentRevision();
      },
      async truncateFrom(messageId) {
        ensureOpen();
        const target = db
          .prepare('SELECT sequence FROM transcript_message WHERE id = ?')
          .get(messageId) as { sequence: number } | undefined;
        if (target === undefined) {
          const remaining = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
            count: number;
          };
          return { found: false, removedCount: 0, remainingCount: remaining.count };
        }
        db.exec('BEGIN');
        try {
          const removedUser = db
            .prepare(
              `SELECT COUNT(*) AS count FROM transcript_message
               WHERE sequence >= ? AND role = 'user' AND length(trim(text)) > 0`,
            )
            .get(target.sequence) as { count: number };
          db.prepare(
            `DELETE FROM native_entry WHERE message_id IN (
               SELECT id FROM transcript_message WHERE sequence >= ?
             )`,
          ).run(target.sequence);
          const removed = db
            .prepare('DELETE FROM transcript_message WHERE sequence >= ?')
            .run(target.sequence);
          const removedCount = Number(removed.changes);
          bumpRevision(removedCount, removedUser.count);
          db.exec('COMMIT');
          const remaining = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
            count: number;
          };
          return {
            found: true,
            removedCount,
            remainingCount: remaining.count,
          };
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
  };
}

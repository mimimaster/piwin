/**
 * Durable bookkeeping for telling the model about finished undo/redo.
 *
 * After an undo or redo succeeds, every session working in that workspace
 * gets one Host note on its next prompt. `operation_notice` records which
 * sessions were told, so a Host restart neither repeats nor loses a note.
 * A session only hears about operations that finished after it started
 * working in the workspace: older history never touched what it read.
 */
import type { DatabaseSync } from 'node:sqlite';

export type TurnChangePendingNotice = {
  operationId: string;
  changeSetId: string;
  direction: 'undo' | 'redo';
  /** When the operation finished (note `updated_at`). */
  finishedAt: string;
  /** The turn's own session; the note says "this conversation" vs "another". */
  turnSessionId: string;
  relativePaths: string[];
};

export type TurnChangeNoticeStore = {
  /**
   * Undo/redo that succeeded in `workspaceId` after `sinceIso` and were not
   * yet delivered to `sessionId`, oldest first.
   */
  listPendingNotices(input: {
    workspaceId: string;
    sessionId: string;
    sinceIso: string;
    limit: number;
  }): TurnChangePendingNotice[];
  markNoticesDelivered(sessionId: string, operationIds: readonly string[], at?: string): void;
  /** Earliest run segment this session started in `workspaceId`, if any. */
  getSessionFirstRunStart(sessionId: string, workspaceId: string): string | undefined;
};

export function bindTurnChangeNoticeStore(db: DatabaseSync): TurnChangeNoticeStore {
  const selectPending = db.prepare(
    `SELECT o.operation_id, o.change_set_id, o.kind, n.updated_at, a.session_id
     FROM operation o
     JOIN operation_note n ON n.operation_id = o.operation_id
     JOIN attempt a ON a.change_set_id = o.change_set_id
     WHERE n.workspace_id = ?
       AND o.kind IN ('undo', 'redo')
       AND o.status = 'succeeded'
       AND n.updated_at > ?
       AND NOT EXISTS (
         SELECT 1 FROM operation_notice d
         WHERE d.operation_id = o.operation_id AND d.session_id = ?
       )
     ORDER BY n.updated_at ASC, o.operation_id ASC
     LIMIT ?`,
  );
  const selectPaths = db.prepare(
    `SELECT relative_path FROM operation_file WHERE operation_id = ? ORDER BY relative_path`,
  );
  const insertDelivered = db.prepare(
    `INSERT OR IGNORE INTO operation_notice(operation_id, session_id, delivered_at) VALUES (?, ?, ?)`,
  );
  const selectFirstRun = db.prepare(
    `SELECT MIN(r.started_at) AS started_at
     FROM run_segment r
     JOIN attempt a ON a.attempt_id = r.attempt_id
     WHERE a.session_id = ? AND a.workspace_id = ?`,
  );

  return {
    listPendingNotices(input) {
      const rows = selectPending.all(
        input.workspaceId,
        input.sinceIso,
        input.sessionId,
        Math.max(1, input.limit),
      ) as Array<{
        operation_id: string;
        change_set_id: string;
        kind: string;
        updated_at: string;
        session_id: string;
      }>;
      return rows.map((row) => ({
        operationId: row.operation_id,
        changeSetId: row.change_set_id,
        direction: row.kind === 'redo' ? 'redo' : 'undo',
        finishedAt: row.updated_at,
        turnSessionId: row.session_id,
        relativePaths: (selectPaths.all(row.operation_id) as Array<{ relative_path: string }>).map(
          (path) => path.relative_path,
        ),
      }));
    },
    markNoticesDelivered(sessionId, operationIds, at = new Date().toISOString()) {
      if (operationIds.length === 0) return;
      db.exec('BEGIN');
      try {
        for (const operationId of operationIds) insertDelivered.run(operationId, sessionId, at);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    getSessionFirstRunStart(sessionId, workspaceId) {
      const row = selectFirstRun.get(sessionId, workspaceId) as { started_at: string | null } | undefined;
      return row?.started_at ?? undefined;
    },
  };
}

/**
 * Undo/redo bookkeeping beyond the core operation row: which workspace it ran
 * in, when, why it stopped, and whether a cancel was requested before its
 * first write. Kept in `operation_note` so the v1 `operation` table (shared
 * with subagent apply) stays unchanged.
 */
import type { DatabaseSync } from 'node:sqlite';

export type TurnChangeOperationNote = {
  operationId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  reason: string | null;
  cancelRequested: boolean;
  /** Files an undo left alone because they changed after the turn (command-created only). */
  skippedPaths: readonly string[];
};

export type TurnChangeOperationLogRow = {
  operationId: string;
  changeSetId: string;
  kind: string;
  status: string;
  expectedRevision: number;
  sessionId: string;
  workspaceId: string;
  createdAt: string | null;
  updatedAt: string | null;
  reason: string | null;
  fileCount: number;
  /** A later undo/redo exists for the same change set. */
  superseded: boolean;
};

export type TurnChangeOperationLogStore = {
  /** Start the note for a new undo/redo; a replay keeps the original row. */
  recordOperationStart(input: { operationId: string; workspaceId: string; at?: string }): void;
  /** Stamp a status change's reason and time (status itself lives on `operation`). */
  noteOperationUpdate(operationId: string, reason?: string | null, at?: string): void;
  getOperationNote(operationId: string): TurnChangeOperationNote | undefined;
  /** The change set's most recent undo/redo, if any. */
  getLatestChangeSetOperation(
    changeSetId: string,
  ): { operationId: string; kind: string; status: string } | undefined;
  /** Files the operation left alone (an undo over command-created files that changed since). */
  recordOperationSkipped(operationId: string, paths: readonly string[]): void;
  /** Flag a cancel; the runner honors it only before the first write. */
  requestOperationCancel(operationId: string): void;
  isOperationCancelRequested(operationId: string): boolean;
  /**
   * Undo/redo operations in one workspace, newest first. `cursor` is the
   * previous page's last `created_at|operation_id`.
   */
  listWorkspaceOperations(input: {
    workspaceId: string;
    limit: number;
    cursor?: string;
  }): { rows: TurnChangeOperationLogRow[]; nextCursor: string | null };
  /**
   * Undo/redo stopped at `needs-repair`, with their workspace root and the
   * paths they touched. Read on every gated write, so a stuck operation keeps
   * blocking across Host restarts without any in-memory state.
   */
  listStuckOperations(): TurnChangeStuckOperation[];
};

export type TurnChangeStuckOperation = {
  operationId: string;
  workspaceId: string;
  rootPath: string;
  relativePaths: string[];
};

type LogRow = {
  operation_id: string;
  change_set_id: string;
  kind: string;
  status: string;
  expected_revision: number;
  session_id: string;
  workspace_id: string;
  created_at: string | null;
  updated_at: string | null;
  reason: string | null;
  file_count: number;
  superseded: number;
};

type NoteRow = {
  operation_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  reason: string | null;
  cancel_requested: number;
  skipped_paths_json: string;
};

function parseSkippedPaths(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseCursor(cursor: string | undefined): { createdAt: string; operationId: string } | null {
  if (!cursor) return null;
  const split = cursor.indexOf('|');
  if (split <= 0) return null;
  return { createdAt: cursor.slice(0, split), operationId: cursor.slice(split + 1) };
}

export function bindTurnChangeOperationLogStore(db: DatabaseSync): TurnChangeOperationLogStore {
  const insertNote = db.prepare(
    `INSERT OR IGNORE INTO operation_note(operation_id, workspace_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  const updateNote = db.prepare(
    `UPDATE operation_note SET updated_at = ?, reason = COALESCE(?, reason) WHERE operation_id = ?`,
  );
  const selectNote = db.prepare(`SELECT * FROM operation_note WHERE operation_id = ?`);
  const selectLatest = db.prepare(
    `SELECT o.operation_id, o.kind, o.status FROM operation o
     JOIN operation_note n ON n.operation_id = o.operation_id
     WHERE o.change_set_id = ? AND o.kind IN ('undo', 'redo')
     ORDER BY n.created_at DESC, o.rowid DESC LIMIT 1`,
  );
  const updateSkipped = db.prepare(
    `UPDATE operation_note SET skipped_paths_json = ? WHERE operation_id = ?`,
  );
  const flagCancel = db.prepare(
    `UPDATE operation_note SET cancel_requested = 1 WHERE operation_id = ?`,
  );
  // Only undo/redo belong to the user-facing record; subagent apply has its own UI.
  const selectPage = db.prepare(
    `SELECT o.operation_id, o.change_set_id, o.kind, o.status, o.expected_revision,
            a.session_id, n.workspace_id, n.created_at, n.updated_at, n.reason,
            (SELECT count(*) FROM operation_file f WHERE f.operation_id = o.operation_id) AS file_count,
            EXISTS (
              SELECT 1 FROM operation later
              JOIN operation_note ln ON ln.operation_id = later.operation_id
              WHERE later.change_set_id = o.change_set_id
                AND later.kind IN ('undo', 'redo')
                AND later.status = 'succeeded'
                AND (ln.created_at > n.created_at
                     OR (ln.created_at = n.created_at AND later.operation_id > o.operation_id))
            ) AS superseded
     FROM operation_note n
     JOIN operation o ON o.operation_id = n.operation_id
     JOIN attempt a ON a.change_set_id = o.change_set_id
     WHERE n.workspace_id = ?
       AND o.kind IN ('undo', 'redo')
       AND (? IS NULL OR n.created_at < ? OR (n.created_at = ? AND o.operation_id < ?))
     ORDER BY n.created_at DESC, o.operation_id DESC
     LIMIT ?`,
  );
  const selectStuck = db.prepare(
    `SELECT o.operation_id, w.workspace_id, w.root_path, f.relative_path
     FROM operation o
     JOIN attempt a ON a.change_set_id = o.change_set_id
     JOIN workspace w ON w.workspace_id = a.workspace_id
     LEFT JOIN operation_file f ON f.operation_id = o.operation_id
     WHERE o.status = 'needs-repair' AND o.kind IN ('undo', 'redo')
     ORDER BY o.operation_id, f.relative_path`,
  );

  return {
    recordOperationStart(input) {
      const at = input.at ?? new Date().toISOString();
      insertNote.run(input.operationId, input.workspaceId, at, at);
    },
    noteOperationUpdate(operationId, reason = null, at = new Date().toISOString()) {
      updateNote.run(at, reason, operationId);
    },
    getOperationNote(operationId) {
      const row = selectNote.get(operationId) as NoteRow | undefined;
      if (!row) return undefined;
      return {
        operationId: row.operation_id,
        workspaceId: row.workspace_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        reason: row.reason,
        cancelRequested: row.cancel_requested === 1,
        skippedPaths: parseSkippedPaths(row.skipped_paths_json),
      };
    },
    recordOperationSkipped(operationId, paths) {
      updateSkipped.run(JSON.stringify(paths), operationId);
    },
    requestOperationCancel(operationId) {
      flagCancel.run(operationId);
    },
    getLatestChangeSetOperation(changeSetId) {
      const row = selectLatest.get(changeSetId) as
        | { operation_id: string; kind: string; status: string }
        | undefined;
      return row
        ? { operationId: row.operation_id, kind: row.kind, status: row.status }
        : undefined;
    },
    isOperationCancelRequested(operationId) {
      const row = selectNote.get(operationId) as NoteRow | undefined;
      return row?.cancel_requested === 1;
    },
    listWorkspaceOperations(input) {
      const cursor = parseCursor(input.cursor);
      const limit = Math.max(1, input.limit);
      const rows = selectPage.all(
        input.workspaceId,
        cursor?.createdAt ?? null,
        cursor?.createdAt ?? null,
        cursor?.createdAt ?? null,
        cursor?.operationId ?? null,
        limit + 1,
      ) as LogRow[];
      const page = rows.slice(0, limit).map((row) => ({
        operationId: row.operation_id,
        changeSetId: row.change_set_id,
        kind: row.kind,
        status: row.status,
        expectedRevision: row.expected_revision,
        sessionId: row.session_id,
        workspaceId: row.workspace_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        reason: row.reason,
        fileCount: row.file_count,
        superseded: row.superseded === 1,
      }));
      const last = page.at(-1);
      return {
        rows: page,
        nextCursor:
          rows.length > limit && last?.createdAt ? `${last.createdAt}|${last.operationId}` : null,
      };
    },
    listStuckOperations() {
      const rows = selectStuck.all() as Array<{
        operation_id: string;
        workspace_id: string;
        root_path: string;
        relative_path: string | null;
      }>;
      const byId = new Map<string, TurnChangeStuckOperation>();
      for (const row of rows) {
        let entry = byId.get(row.operation_id);
        if (!entry) {
          entry = {
            operationId: row.operation_id,
            workspaceId: row.workspace_id,
            rootPath: row.root_path,
            relativePaths: [],
          };
          byId.set(row.operation_id, entry);
        }
        if (row.relative_path !== null) entry.relativePaths.push(row.relative_path);
      }
      return [...byId.values()];
    },
  };
}

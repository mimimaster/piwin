/**
 * Storage for sealing a turn: shell audits recorded while it ran, and the
 * note published with each sealed version (why it is incomplete, which paths
 * commands changed outside the undo scope).
 */
import type { DatabaseSync } from 'node:sqlite';

/** What one shell command did to the workspace's tracked files. */
export type TurnChangeShellAudit = {
  runId: string;
  toolCallId: string;
  /**
   * clean: nothing changed; changed: `paths` moved; unknown: could not tell;
   * capture-failed: a Host write's receipt could not be persisted;
   * storage-full: the write's undo bytes were not kept (store over budget).
   */
  status: 'clean' | 'changed' | 'unknown' | 'capture-failed' | 'storage-full';
  /** Workspace-relative paths the command changed. */
  paths: readonly string[];
};

export type TurnChangeVersionNote = {
  changeSetId: string;
  revision: number;
  incompleteReason: string | null;
  /** Paths commands changed that are not part of this version's undo. */
  excludedPaths: readonly string[];
  /** Paths a command changed that the turn also wrote and that could not be chained. */
  overlappingPaths: readonly string[];
  sealedAt: string;
};

export type TurnChangeSealStore = {
  recordShellAudit(audit: TurnChangeShellAudit): void;
  listShellAuditsByRun(runId: string): TurnChangeShellAudit[];
  recordVersionNote(note: TurnChangeVersionNote): void;
  getVersionNote(changeSetId: string, revision: number): TurnChangeVersionNote | undefined;
  /** Point the attempt at a sealed version and set its capture state. */
  activateVersion(changeSetId: string, revision: number, captureState: string): void;
  getAttemptIdByRun(runId: string): string | undefined;
  getChangeSetIdByAttempt(attemptId: string): string | undefined;
  /** Change sets in capture state `collecting` whose run segments all ended. */
  listUnsealedEndedChangeSets(limit: number): string[];
  /**
   * Close every segment still open. Only for Host startup: no run survives a
   * Host restart, and an open segment would keep its turn unsealed forever.
   */
  endOrphanedRunSegments(endedAt: string): string[];
  /** Re-point an attempt at the workspace its writes actually happened in. */
  setAttemptWorkspace(changeSetId: string, workspaceId: string): void;
};

type ShellAuditRow = { run_id: string; tool_call_id: string; status: string; paths_json: string };
type VersionNoteRow = {
  change_set_id: string;
  revision: number;
  incomplete_reason: string | null;
  excluded_paths_json: string;
  overlapping_paths_json: string;
  sealed_at: string;
};

function parsePaths(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function parseAuditStatus(status: string): TurnChangeShellAudit['status'] {
  return status === 'clean' ||
    status === 'changed' ||
    status === 'capture-failed' ||
    status === 'storage-full'
    ? status
    : 'unknown';
}

export function bindTurnChangeSealStore(db: DatabaseSync): TurnChangeSealStore {
  const upsertAudit = db.prepare(
    `INSERT INTO shell_audit(run_id, tool_call_id, status, paths_json) VALUES (?, ?, ?, ?)
     ON CONFLICT(run_id, tool_call_id) DO UPDATE SET
       status = excluded.status, paths_json = excluded.paths_json`,
  );
  const selectAudits = db.prepare(`SELECT * FROM shell_audit WHERE run_id = ? ORDER BY rowid ASC`);
  const upsertNote = db.prepare(
    `INSERT INTO change_version_note(
       change_set_id, revision, incomplete_reason, excluded_paths_json,
       overlapping_paths_json, sealed_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(change_set_id, revision) DO UPDATE SET
       incomplete_reason = excluded.incomplete_reason,
       excluded_paths_json = excluded.excluded_paths_json,
       overlapping_paths_json = excluded.overlapping_paths_json,
       sealed_at = excluded.sealed_at`,
  );
  const selectNote = db.prepare(
    `SELECT * FROM change_version_note WHERE change_set_id = ? AND revision = ?`,
  );
  const updateActive = db.prepare(
    `UPDATE attempt SET active_revision = ?, capture_state = ? WHERE change_set_id = ?`,
  );
  const selectAttemptByRun = db.prepare(`SELECT attempt_id FROM run_segment WHERE run_id = ?`);
  const selectChangeSetByAttempt = db.prepare(
    `SELECT change_set_id FROM attempt WHERE attempt_id = ?`,
  );
  const selectUnsealed = db.prepare(
    `SELECT a.change_set_id FROM attempt a
     WHERE a.capture_state = 'collecting'
       AND EXISTS (SELECT 1 FROM run_segment r WHERE r.attempt_id = a.attempt_id)
       AND NOT EXISTS (
         SELECT 1 FROM run_segment r WHERE r.attempt_id = a.attempt_id AND r.ended_at IS NULL
       )
     ORDER BY a.rowid DESC LIMIT ?`,
  );

  const selectOpenSegments = db.prepare(`SELECT run_id FROM run_segment WHERE ended_at IS NULL`);
  const updateAttemptWorkspace = db.prepare(
    `UPDATE attempt SET workspace_id = ? WHERE change_set_id = ?`,
  );
  const closeOpenSegments = db.prepare(`UPDATE run_segment SET ended_at = ? WHERE ended_at IS NULL`);

  return {
    recordShellAudit(audit) {
      upsertAudit.run(audit.runId, audit.toolCallId, audit.status, JSON.stringify(audit.paths));
    },
    listShellAuditsByRun(runId) {
      return (selectAudits.all(runId) as ShellAuditRow[]).map((row) => ({
        runId: row.run_id,
        toolCallId: row.tool_call_id,
        status: parseAuditStatus(row.status),
        paths: parsePaths(row.paths_json),
      }));
    },
    recordVersionNote(note) {
      upsertNote.run(
        note.changeSetId,
        note.revision,
        note.incompleteReason,
        JSON.stringify(note.excludedPaths),
        JSON.stringify(note.overlappingPaths),
        note.sealedAt,
      );
    },
    getVersionNote(changeSetId, revision) {
      const row = selectNote.get(changeSetId, revision) as VersionNoteRow | undefined;
      if (!row) return undefined;
      return {
        changeSetId: row.change_set_id,
        revision: row.revision,
        incompleteReason: row.incomplete_reason,
        excludedPaths: parsePaths(row.excluded_paths_json),
        overlappingPaths: parsePaths(row.overlapping_paths_json),
        sealedAt: row.sealed_at,
      };
    },
    activateVersion(changeSetId, revision, captureState) {
      updateActive.run(revision, captureState, changeSetId);
    },
    getAttemptIdByRun(runId) {
      return (selectAttemptByRun.get(runId) as { attempt_id: string } | undefined)?.attempt_id;
    },
    getChangeSetIdByAttempt(attemptId) {
      return (selectChangeSetByAttempt.get(attemptId) as { change_set_id: string } | undefined)
        ?.change_set_id;
    },
    setAttemptWorkspace(changeSetId, workspaceId) {
      updateAttemptWorkspace.run(workspaceId, changeSetId);
    },
    endOrphanedRunSegments(endedAt) {
      const runIds = (selectOpenSegments.all() as Array<{ run_id: string }>).map((row) => row.run_id);
      if (runIds.length > 0) {
        closeOpenSegments.run(endedAt);
      }
      return runIds;
    },
    listUnsealedEndedChangeSets(limit) {
      return (selectUnsealed.all(limit) as Array<{ change_set_id: string }>).map(
        (row) => row.change_set_id,
      );
    },
  };
}

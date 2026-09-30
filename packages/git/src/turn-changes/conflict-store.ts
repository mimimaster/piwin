/**
 * Which later turns touched a path, for explaining an undo conflict.
 *
 * "Later" means sealed after this turn, in the same workspace, with a version
 * that lists the path. A path with no such turn was changed by something the
 * Host did not record (an editor, a command, another tool); callers say
 * "source unknown" instead of guessing.
 */
import type { DatabaseSync } from 'node:sqlite';

export type TurnChangeLaterTurnRecord = {
  changeSetId: string;
  sessionId: string;
  runIds: string[];
  endedAt: string | null;
};

export type TurnChangeConflictStore = {
  /** Per path, the later turns (oldest first) whose active version changed it. */
  findLaterTurnsByPath(input: {
    changeSetId: string;
    relativePaths: readonly string[];
  }): Map<string, TurnChangeLaterTurnRecord[]>;
  /** Recorded turns of a session that still hold file changes (not expired). */
  countSessionChangeSets(sessionId: string): number;
};

/** Later turns listed per path; the oldest are the ones worth undoing first. */
const MAX_LATER_TURNS_PER_PATH = 5;

export function bindTurnChangeConflictStore(db: DatabaseSync): TurnChangeConflictStore {
  const selectSelf = db.prepare(
    `SELECT a.workspace_id, n.sealed_at
     FROM attempt a
     LEFT JOIN change_version_note n
       ON n.change_set_id = a.change_set_id AND n.revision = a.active_revision
     WHERE a.change_set_id = ?`,
  );
  const selectLater = db.prepare(
    `SELECT a.change_set_id, a.session_id, a.attempt_id, n.sealed_at
     FROM change_file f
     JOIN attempt a ON a.change_set_id = f.change_set_id AND a.active_revision = f.revision
     JOIN change_version_note n ON n.change_set_id = a.change_set_id AND n.revision = a.active_revision
     WHERE f.relative_path = ?
       AND a.workspace_id = ?
       AND a.change_set_id <> ?
       AND a.disposition = 'applied'
       AND n.sealed_at > ?
     ORDER BY n.sealed_at ASC
     LIMIT ?`,
  );
  const selectRuns = db.prepare(
    `SELECT run_id FROM run_segment WHERE attempt_id = ? ORDER BY rowid ASC`,
  );
  const countSession = db.prepare(
    `SELECT count(*) AS n FROM attempt a
     JOIN change_version v ON v.change_set_id = a.change_set_id AND v.revision = a.active_revision
     WHERE a.session_id = ? AND a.capture_state <> 'expired' AND COALESCE(v.file_count, 0) > 0`,
  );

  return {
    countSessionChangeSets(sessionId) {
      return (countSession.get(sessionId) as { n: number } | undefined)?.n ?? 0;
    },
    findLaterTurnsByPath(input) {
      const result = new Map<string, TurnChangeLaterTurnRecord[]>();
      const self = selectSelf.get(input.changeSetId) as
        | { workspace_id: string; sealed_at: string | null }
        | undefined;
      for (const path of input.relativePaths) result.set(path, []);
      if (!self?.sealed_at) return result;
      for (const path of input.relativePaths) {
        const rows = selectLater.all(
          path,
          self.workspace_id,
          input.changeSetId,
          self.sealed_at,
          MAX_LATER_TURNS_PER_PATH,
        ) as Array<{ change_set_id: string; session_id: string; attempt_id: string; sealed_at: string }>;
        result.set(
          path,
          rows.map((row) => ({
            changeSetId: row.change_set_id,
            sessionId: row.session_id,
            runIds: (selectRuns.all(row.attempt_id) as Array<{ run_id: string }>).map((run) => run.run_id),
            endedAt: row.sealed_at,
          })),
        );
      }
      return result;
    },
  };
}

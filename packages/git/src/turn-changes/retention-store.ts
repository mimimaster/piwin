/**
 * Retention queries for the turn-change store.
 *
 * Objects stay while something references them: a live turn's write
 * receipts (`file-action`), a version's files (`change-file`), an undo/redo's
 * per-file backups (`operation-file`), or a subagent result. Expiring an old
 * turn drops all three of its reference kinds but keeps its
 * metadata, so history still shows what the turn changed and says its undo
 * data is gone. `orphan-put` marks bytes put before any real reference
 * exists; on its own it protects nothing past the grace period.
 */
import type { DatabaseSync } from 'node:sqlite';

export type TurnChangeRetentionStore = {
  /**
   * Turn change sets whose run segments all ended before `cutoffIso`, not yet
   * expired, with no undo/redo still applying or awaiting repair, and none
   * that finished after `operationCutoffIso` (so 恢复改动 keeps working for a
   * while after an undo late in the window).
   * Subagent results have no run segments and are left to their own lifecycle.
   */
  listExpirableChangeSets(cutoffIso: string, limit: number, operationCutoffIso?: string): string[];
  /**
   * Mark expired and drop the references that kept its bytes alive: version
   * files, write receipts, and its finished undo/redo backups.
   */
  expireChangeSet(changeSetId: string): void;
  /** Hashes that must stay: any non-orphan reference, or an in-flight operation. */
  listReferencedObjectHashes(): Set<string>;
  /** Drop orphan markers for a hash that has been deleted from disk. */
  deleteOrphanRefs(sha256: string): void;
};

export function bindTurnChangeRetentionStore(db: DatabaseSync): TurnChangeRetentionStore {
  const selectExpirable = db.prepare(
    `SELECT a.change_set_id FROM attempt a
     WHERE a.capture_state <> 'expired'
       AND EXISTS (SELECT 1 FROM run_segment r WHERE r.attempt_id = a.attempt_id)
       AND NOT EXISTS (
         SELECT 1 FROM run_segment r
         WHERE r.attempt_id = a.attempt_id AND (r.ended_at IS NULL OR r.ended_at >= ?)
       )
       AND NOT EXISTS (
         SELECT 1 FROM operation o
         WHERE o.change_set_id = a.change_set_id AND o.status IN ('applying', 'needs-repair')
       )
       AND NOT EXISTS (
         SELECT 1 FROM operation o JOIN operation_note n ON n.operation_id = o.operation_id
         WHERE o.change_set_id = a.change_set_id AND n.updated_at >= ?
       )
     ORDER BY a.rowid ASC LIMIT ?`,
  );
  const markExpired = db.prepare(
    `UPDATE attempt SET capture_state = 'expired' WHERE change_set_id = ?`,
  );
  const dropChangeFileRefs = db.prepare(
    `DELETE FROM object_ref WHERE ref_kind = 'change-file'
       AND ref_id IN (SELECT file_id FROM change_file WHERE change_set_id = ?)`,
  );
  const dropFileActionRefs = db.prepare(
    `DELETE FROM object_ref WHERE ref_kind = 'file-action'
       AND ref_id IN (
         SELECT f.action_id FROM file_action f
         JOIN run_segment r ON r.run_id = f.run_id
         JOIN attempt a ON a.attempt_id = r.attempt_id
         WHERE a.change_set_id = ?
       )`,
  );
  // ref_id is `<operationId>:<relativePath>:<side>` (operation-store pinSha).
  const dropOperationFileRefs = db.prepare(
    `DELETE FROM object_ref WHERE ref_kind = 'operation-file'
       AND EXISTS (
         SELECT 1 FROM operation o
         WHERE o.change_set_id = ?
           AND o.status NOT IN ('applying', 'needs-repair')
           AND substr(object_ref.ref_id, 1, length(o.operation_id) + 1) = o.operation_id || ':'
       )`,
  );
  const selectReferenced = db.prepare(
    `SELECT DISTINCT sha256 AS sha FROM object_ref WHERE ref_kind <> 'orphan-put'
     UNION
     SELECT sha FROM (
       SELECT f.from_sha AS sha FROM operation_file f JOIN operation o ON o.operation_id = f.operation_id
         WHERE o.status IN ('applying', 'needs-repair')
       UNION SELECT f.to_sha FROM operation_file f JOIN operation o ON o.operation_id = f.operation_id
         WHERE o.status IN ('applying', 'needs-repair')
       UNION SELECT f.backup_sha FROM operation_file f JOIN operation o ON o.operation_id = f.operation_id
         WHERE o.status IN ('applying', 'needs-repair')
     ) WHERE sha IS NOT NULL`,
  );
  const dropOrphanRefs = db.prepare(
    `DELETE FROM object_ref WHERE ref_kind = 'orphan-put' AND sha256 = ?`,
  );

  return {
    listExpirableChangeSets(cutoffIso, limit, operationCutoffIso = cutoffIso) {
      return (
        selectExpirable.all(cutoffIso, operationCutoffIso, limit) as Array<{ change_set_id: string }>
      ).map(
        (row) => row.change_set_id,
      );
    },
    expireChangeSet(changeSetId) {
      db.exec('BEGIN');
      try {
        dropChangeFileRefs.run(changeSetId);
        dropFileActionRefs.run(changeSetId);
        dropOperationFileRefs.run(changeSetId);
        markExpired.run(changeSetId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    listReferencedObjectHashes() {
      return new Set((selectReferenced.all() as Array<{ sha: string }>).map((row) => row.sha));
    },
    deleteOrphanRefs(sha256) {
      dropOrphanRefs.run(sha256);
    },
  };
}

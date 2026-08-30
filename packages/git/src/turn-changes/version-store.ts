/**
 * Persist an immutable change_version + change_file snapshot. Bytes must
 * already be in the CAS; this only records refs.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { ComposedFileAction } from './compose.js';

const CHANGE_FILE_REF_KIND = 'change-file';

export type TurnChangeVersionFile = {
  fileId: string;
  relativePath: string;
  kind: 'added' | 'modified' | 'deleted';
  beforeSha: string | null;
  afterSha: string | null;
};

export type TurnChangeVersionRecord = {
  changeSetId: string;
  revision: number;
  fileCount: number;
  coverageComplete: boolean;
  files: readonly TurnChangeVersionFile[];
};

export type TurnChangeVersionStore = {
  publishChangeVersion(input: {
    changeSetId: string;
    revision: number;
    files: readonly ComposedFileAction[];
    coverageComplete: boolean;
  }): TurnChangeVersionRecord;
  getChangeVersion(changeSetId: string, revision: number): TurnChangeVersionRecord | undefined;
};

export function bindTurnChangeVersionStore(db: DatabaseSync): TurnChangeVersionStore {
  const insertVersion = db.prepare(
    `INSERT INTO change_version(
       change_set_id, revision, file_count, additions, deletions,
       binary_file_count, coverage_complete
     ) VALUES (?, ?, ?, NULL, NULL, 0, ?)`,
  );
  const insertFile = db.prepare(
    `INSERT INTO change_file(
       change_set_id, revision, file_id, relative_path, kind, before_sha, after_sha
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const pin = db.prepare(
    `INSERT INTO object_ref(sha256, ref_kind, ref_id, pin_until)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(sha256, ref_kind, ref_id) DO NOTHING`,
  );
  const selectVersion = db.prepare(
    `SELECT change_set_id, revision, file_count, coverage_complete
     FROM change_version WHERE change_set_id = ? AND revision = ?`,
  );
  const selectFiles = db.prepare(
    `SELECT file_id, relative_path, kind, before_sha, after_sha
     FROM change_file WHERE change_set_id = ? AND revision = ?
     ORDER BY relative_path ASC`,
  );

  return {
    publishChangeVersion(input) {
      const files = input.files.map((file) => ({
        fileId: randomUUID(),
        relativePath: file.relativePath,
        kind: fileKind(file),
        beforeSha: file.beforeSha,
        afterSha: file.afterSha,
      }));
      db.exec('BEGIN');
      try {
        insertVersion.run(
          input.changeSetId,
          input.revision,
          files.length,
          input.coverageComplete ? 1 : 0,
        );
        for (const file of files) {
          insertFile.run(
            input.changeSetId,
            input.revision,
            file.fileId,
            file.relativePath,
            file.kind,
            file.beforeSha,
            file.afterSha,
          );
          if (file.beforeSha) pin.run(file.beforeSha, CHANGE_FILE_REF_KIND, file.fileId);
          if (file.afterSha) pin.run(file.afterSha, CHANGE_FILE_REF_KIND, file.fileId);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return {
        changeSetId: input.changeSetId,
        revision: input.revision,
        fileCount: files.length,
        coverageComplete: input.coverageComplete,
        files,
      };
    },

    getChangeVersion(changeSetId, revision) {
      const row = selectVersion.get(changeSetId, revision) as
        | {
            change_set_id: string;
            revision: number;
            file_count: number;
            coverage_complete: number;
          }
        | undefined;
      if (!row) return undefined;
      const fileRows = selectFiles.all(changeSetId, revision) as Array<{
        file_id: string;
        relative_path: string;
        kind: string;
        before_sha: string | null;
        after_sha: string | null;
      }>;
      return {
        changeSetId: row.change_set_id,
        revision: row.revision,
        fileCount: row.file_count,
        coverageComplete: row.coverage_complete === 1,
        files: fileRows.map((file) => ({
          fileId: file.file_id,
          relativePath: file.relative_path,
          kind: file.kind as TurnChangeVersionFile['kind'],
          beforeSha: file.before_sha,
          afterSha: file.after_sha,
        })),
      };
    },
  };
}

function fileKind(file: ComposedFileAction): TurnChangeVersionFile['kind'] {
  if (!file.beforeExists && file.afterExists) return 'added';
  if (file.beforeExists && !file.afterExists) return 'deleted';
  return 'modified';
}

/**
 * Operation / operation_file / idempotency helpers. Callers must not await FS
 * while a sqlite transaction opened here is open.
 */
import type { DatabaseSync } from 'node:sqlite';

const OPERATION_FILE_REF_KIND = 'operation-file';

type OperationRow = {
  operation_id: string;
  change_set_id: string;
  kind: string;
  status: string;
  expected_revision: number;
  direction: string | null;
};

type OperationFileRow = {
  operation_id: string;
  relative_path: string;
  from_sha: string | null;
  to_sha: string | null;
  backup_sha: string | null;
  from_exists: number;
  to_exists: number;
  status: string;
};

type IdempotencyRow = {
  principal: string;
  key: string;
  request_hash: string;
  operation_id: string;
};

export type TurnChangeOperationKind = 'undo' | 'redo' | 'subagent-apply';

export const SUBAGENT_APPLY_RESOURCE_PRINCIPAL = 'subagent-apply';

export type TurnChangeOperationRecord = {
  operationId: string;
  changeSetId: string;
  kind: string;
  status: string;
  expectedRevision: number;
  direction: string | null;
};

export type SubagentApplyReservationRecord = {
  operationId: string;
  resultId: string;
  candidateGroupId: string | null;
  status: string;
  changeSetId: string;
  expectedRevision: number;
};

export type SubagentApplyReserveResult =
  | { outcome: 'created'; operationId: string }
  | { outcome: 'replay'; operationId: string; status: string }
  | {
      outcome: 'conflict';
      operationId: string;
      code: 'already-applied' | 'candidate-group-selected' | 'needs-repair';
    };

export type TurnChangeOperationFileRecord = {
  operationId: string;
  relativePath: string;
  fromSha: string | null;
  toSha: string | null;
  backupSha: string | null;
  fromExists: boolean;
  toExists: boolean;
  status: string;
};

export type TurnChangeBeginOperationResult = {
  outcome: 'created' | 'replay';
  operationId: string;
};

export type TurnChangeOperationStore = {
  beginOperation(input: {
    operationId: string;
    changeSetId: string;
    kind: TurnChangeOperationKind;
    expectedRevision: number;
    principal: string;
    idempotencyKey: string;
    requestHash: string;
  }): TurnChangeBeginOperationResult;
  getOperation(operationId: string): TurnChangeOperationRecord | undefined;
  updateOperationStatus(operationId: string, status: string): void;
  recordOperationFiles(files: readonly TurnChangeOperationFileRecord[]): void;
  listOperationFiles(operationId: string): TurnChangeOperationFileRecord[];
  updateOperationFileStatus(operationId: string, relativePath: string, status: string): void;
  markAttemptDisposition(changeSetId: string, disposition: string): void;
  reserveSubagentApply(input: {
    operationId: string;
    changeSetId: string;
    expectedRevision: number;
    principal: string;
    idempotencyKey: string;
    requestHash: string;
    resultId: string;
    candidateGroupId?: string | null;
  }): SubagentApplyReserveResult;
  releaseSubagentApplyReservation(operationId: string): void;
  getSubagentApplyReservation(query: {
    resultId?: string;
    candidateGroupId?: string;
  }): SubagentApplyReservationRecord | undefined;
  listSubagentApplyReservations(): SubagentApplyReservationRecord[];
  listOperationsByKind(kind: string): TurnChangeOperationRecord[];
};

export function bindTurnChangeOperationStore(db: DatabaseSync): TurnChangeOperationStore {
  const selectIdempotency = db.prepare(
    `SELECT * FROM idempotency WHERE principal = ? AND key = ?`,
  );
  const insertOperation = db.prepare(
    `INSERT INTO operation(operation_id, change_set_id, kind, status, expected_revision, direction)
     VALUES (?, ?, ?, 'applying', ?, ?)`,
  );
  const insertIdempotency = db.prepare(
    `INSERT INTO idempotency(principal, key, request_hash, operation_id)
     VALUES (?, ?, ?, ?)`,
  );
  const upsertIdempotency = db.prepare(
    `INSERT INTO idempotency(principal, key, request_hash, operation_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(principal, key) DO UPDATE SET
       request_hash = excluded.request_hash,
       operation_id = excluded.operation_id`,
  );
  const deleteIdempotencyByOperation = db.prepare(
    `DELETE FROM idempotency WHERE operation_id = ?`,
  );
  const selectIdempotencyByPrincipal = db.prepare(
    `SELECT * FROM idempotency WHERE principal = ? ORDER BY rowid ASC`,
  );
  const selectOperationsByKind = db.prepare(
    `SELECT * FROM operation WHERE kind = ? ORDER BY rowid ASC`,
  );
  const selectOperation = db.prepare(`SELECT * FROM operation WHERE operation_id = ?`);
  const updateOperationStatus = db.prepare(`UPDATE operation SET status = ? WHERE operation_id = ?`);
  const upsertOperationFile = db.prepare(
    `INSERT INTO operation_file(
       operation_id, relative_path, from_sha, to_sha, backup_sha,
       from_exists, to_exists, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(operation_id, relative_path) DO UPDATE SET
       from_sha = excluded.from_sha,
       to_sha = excluded.to_sha,
       backup_sha = excluded.backup_sha,
       from_exists = excluded.from_exists,
       to_exists = excluded.to_exists,
       status = excluded.status`,
  );
  const selectOperationFiles = db.prepare(
    `SELECT * FROM operation_file WHERE operation_id = ? ORDER BY rowid ASC`,
  );
  const updateOperationFileStatus = db.prepare(
    `UPDATE operation_file SET status = ? WHERE operation_id = ? AND relative_path = ?`,
  );
  const updateAttemptDisposition = db.prepare(
    `UPDATE attempt SET disposition = ? WHERE change_set_id = ?`,
  );
  const upsertPin = db.prepare(
    `INSERT INTO object_ref(sha256, ref_kind, ref_id, pin_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(sha256, ref_kind, ref_id) DO UPDATE SET pin_until = excluded.pin_until`,
  );

  const replayOrConflict = (row: IdempotencyRow, requestHash: string): TurnChangeBeginOperationResult => {
    if (row.request_hash !== requestHash) {
      throw new Error('idempotency-conflict');
    }
    return { outcome: 'replay', operationId: row.operation_id };
  };

  return {
    beginOperation(input): TurnChangeBeginOperationResult {
      const existing = selectIdempotency.get(input.principal, input.idempotencyKey) as
        | IdempotencyRow
        | undefined;
      if (existing) {
        return replayOrConflict(existing, input.requestHash);
      }

      db.exec('BEGIN');
      try {
        const raced = selectIdempotency.get(input.principal, input.idempotencyKey) as
          | IdempotencyRow
          | undefined;
        if (raced) {
          db.exec('ROLLBACK');
          return replayOrConflict(raced, input.requestHash);
        }
        insertOperation.run(
          input.operationId,
          input.changeSetId,
          input.kind,
          input.expectedRevision,
          input.kind,
        );
        insertIdempotency.run(
          input.principal,
          input.idempotencyKey,
          input.requestHash,
          input.operationId,
        );
        db.exec('COMMIT');
        return { outcome: 'created', operationId: input.operationId };
      } catch (error) {
        db.exec('ROLLBACK');
        const duplicate = selectIdempotency.get(input.principal, input.idempotencyKey) as
          | IdempotencyRow
          | undefined;
        if (duplicate) {
          return replayOrConflict(duplicate, input.requestHash);
        }
        throw error;
      }
    },

    getOperation(operationId: string): TurnChangeOperationRecord | undefined {
      const row = selectOperation.get(operationId) as OperationRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      return mapOperationRow(row);
    },

    updateOperationStatus(operationId: string, status: string): void {
      updateOperationStatus.run(status, operationId);
    },

    recordOperationFiles(files: readonly TurnChangeOperationFileRecord[]): void {
      if (files.length === 0) {
        return;
      }
      db.exec('BEGIN');
      try {
        for (const file of files) {
          upsertOperationFile.run(
            file.operationId,
            file.relativePath,
            file.fromSha,
            file.toSha,
            file.backupSha,
            file.fromExists ? 1 : 0,
            file.toExists ? 1 : 0,
            file.status,
          );
          pinSha(upsertPin, file.fromSha, file.operationId, file.relativePath, 'from');
          pinSha(upsertPin, file.toSha, file.operationId, file.relativePath, 'to');
          pinSha(upsertPin, file.backupSha, file.operationId, file.relativePath, 'backup');
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    listOperationFiles(operationId: string): TurnChangeOperationFileRecord[] {
      const rows = selectOperationFiles.all(operationId) as OperationFileRow[];
      return rows.map(mapOperationFileRow);
    },

    updateOperationFileStatus(operationId: string, relativePath: string, status: string): void {
      updateOperationFileStatus.run(status, operationId, relativePath);
    },

    markAttemptDisposition(changeSetId: string, disposition: string): void {
      updateAttemptDisposition.run(disposition, changeSetId);
    },

    reserveSubagentApply(input): SubagentApplyReserveResult {
      const existing = selectIdempotency.get(input.principal, input.idempotencyKey) as
        | IdempotencyRow
        | undefined;
      if (existing) {
        return replayReservedOperation(existing, input.requestHash, selectOperation);
      }

      db.exec('BEGIN');
      try {
        const raced = selectIdempotency.get(input.principal, input.idempotencyKey) as
          | IdempotencyRow
          | undefined;
        if (raced) {
          db.exec('ROLLBACK');
          return replayReservedOperation(raced, input.requestHash, selectOperation);
        }

        const resultConflict = occupyingReservation(
          selectIdempotency,
          selectOperation,
          subagentApplyResultKey(input.resultId),
        );
        if (resultConflict) {
          db.exec('ROLLBACK');
          return {
            outcome: 'conflict',
            operationId: resultConflict.operationId,
            code: resultConflict.status === 'needs-repair' ? 'needs-repair' : 'already-applied',
          };
        }

        const groupId = input.candidateGroupId;
        if (groupId) {
          const groupConflict = occupyingReservation(
            selectIdempotency,
            selectOperation,
            subagentApplyGroupKey(groupId),
          );
          if (groupConflict) {
            db.exec('ROLLBACK');
            return {
              outcome: 'conflict',
              operationId: groupConflict.operationId,
              code:
                groupConflict.status === 'needs-repair' ? 'needs-repair' : 'candidate-group-selected',
            };
          }
        }

        insertOperation.run(
          input.operationId,
          input.changeSetId,
          'subagent-apply',
          input.expectedRevision,
          'subagent-apply',
        );
        insertIdempotency.run(
          input.principal,
          input.idempotencyKey,
          input.requestHash,
          input.operationId,
        );
        upsertIdempotency.run(
          SUBAGENT_APPLY_RESOURCE_PRINCIPAL,
          subagentApplyResultKey(input.resultId),
          input.resultId,
          input.operationId,
        );
        if (groupId) {
          upsertIdempotency.run(
            SUBAGENT_APPLY_RESOURCE_PRINCIPAL,
            subagentApplyGroupKey(groupId),
            groupId,
            input.operationId,
          );
        }
        db.exec('COMMIT');
        return { outcome: 'created', operationId: input.operationId };
      } catch (error) {
        db.exec('ROLLBACK');
        const duplicate = selectIdempotency.get(input.principal, input.idempotencyKey) as
          | IdempotencyRow
          | undefined;
        if (duplicate) {
          return replayReservedOperation(duplicate, input.requestHash, selectOperation);
        }
        throw error;
      }
    },

    releaseSubagentApplyReservation(operationId: string): void {
      const row = selectOperation.get(operationId) as OperationRow | undefined;
      if (row === undefined) {
        return;
      }
      if (row.status === 'needs-repair' || row.status === 'succeeded') {
        return;
      }
      deleteIdempotencyByOperation.run(operationId);
      updateOperationStatus.run('rejected', operationId);
    },

    getSubagentApplyReservation(query) {
      return listSubagentApplyReservationRecords(
        selectIdempotencyByPrincipal,
        selectOperation,
      ).find((record) => {
        if (query.resultId !== undefined) return record.resultId === query.resultId;
        if (query.candidateGroupId !== undefined) {
          return record.candidateGroupId === query.candidateGroupId;
        }
        return false;
      });
    },

    listSubagentApplyReservations(): SubagentApplyReservationRecord[] {
      return listSubagentApplyReservationRecords(selectIdempotencyByPrincipal, selectOperation);
    },

    listOperationsByKind(kind: string): TurnChangeOperationRecord[] {
      const rows = selectOperationsByKind.all(kind) as OperationRow[];
      return rows.map(mapOperationRow);
    },
  };
}

function mapOperationRow(row: OperationRow): TurnChangeOperationRecord {
  return {
    operationId: row.operation_id,
    changeSetId: row.change_set_id,
    kind: row.kind,
    status: row.status,
    expectedRevision: row.expected_revision,
    direction: row.direction,
  };
}

function mapOperationFileRow(row: OperationFileRow): TurnChangeOperationFileRecord {
  return {
    operationId: row.operation_id,
    relativePath: row.relative_path,
    fromSha: row.from_sha,
    toSha: row.to_sha,
    backupSha: row.backup_sha,
    fromExists: row.from_exists === 1,
    toExists: row.to_exists === 1,
    status: row.status,
  };
}

function pinSha(
  upsertPin: { run(sha256: string, refKind: string, refId: string, pinUntil: string | null): unknown },
  sha: string | null,
  operationId: string,
  relativePath: string,
  side: 'from' | 'to' | 'backup',
): void {
  if (!sha) {
    return;
  }
  upsertPin.run(sha, OPERATION_FILE_REF_KIND, `${operationId}:${relativePath}:${side}`, null);
}

export function subagentApplyResultKey(resultId: string): string {
  return `result:${resultId}`;
}

export function subagentApplyGroupKey(groupId: string): string {
  return `group:${groupId}`;
}

export function occupiesSubagentApplyStatus(status: string): boolean {
  return status === 'applying' || status === 'succeeded' || status === 'needs-repair';
}

function occupyingReservation(
  selectIdempotency: { get(principal: string, key: string): unknown },
  selectOperation: { get(operationId: string): unknown },
  key: string,
): TurnChangeOperationRecord | undefined {
  const row = selectIdempotency.get(SUBAGENT_APPLY_RESOURCE_PRINCIPAL, key) as
    | IdempotencyRow
    | undefined;
  if (!row) {
    return undefined;
  }
  const operation = selectOperation.get(row.operation_id) as OperationRow | undefined;
  if (!operation || !occupiesSubagentApplyStatus(operation.status)) {
    return undefined;
  }
  return mapOperationRow(operation);
}

function replayReservedOperation(
  row: IdempotencyRow,
  requestHash: string,
  selectOperation: { get(operationId: string): unknown },
): SubagentApplyReserveResult {
  if (row.request_hash !== requestHash) {
    throw new Error('idempotency-conflict');
  }
  const operation = selectOperation.get(row.operation_id) as OperationRow | undefined;
  return {
    outcome: 'replay',
    operationId: row.operation_id,
    status: operation?.status ?? 'applying',
  };
}

function listSubagentApplyReservationRecords(
  selectIdempotencyByPrincipal: { all(principal: string): unknown[] },
  selectOperation: { get(operationId: string): unknown },
): SubagentApplyReservationRecord[] {
  const rows = selectIdempotencyByPrincipal.all(SUBAGENT_APPLY_RESOURCE_PRINCIPAL) as IdempotencyRow[];
  const groups = new Map<string, string>();
  const results: IdempotencyRow[] = [];
  for (const row of rows) {
    if (row.key.startsWith('group:')) {
      groups.set(row.operation_id, row.key.slice('group:'.length));
      continue;
    }
    if (row.key.startsWith('result:')) {
      results.push(row);
    }
  }
  const records: SubagentApplyReservationRecord[] = [];
  for (const row of results) {
    const operation = selectOperation.get(row.operation_id) as OperationRow | undefined;
    if (!operation) {
      continue;
    }
    records.push({
      operationId: row.operation_id,
      resultId: row.key.slice('result:'.length),
      candidateGroupId: groups.get(row.operation_id) ?? null,
      status: operation.status,
      changeSetId: operation.change_set_id,
      expectedRevision: operation.expected_revision,
    });
  }
  return records;
}

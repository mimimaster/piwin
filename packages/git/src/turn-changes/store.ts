/**
 * Turn-change metadata store. Bytes live in the CAS; sqlite only holds refs.
 * This is the only runtime `node:sqlite` import in `@piwin/git`.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createTurnChangeObjectStore } from './object-store.js';
import {
  TURN_CHANGE_DATABASE_FILENAME,
  migrateTurnChangeSchema,
} from './schema.js';

const ORPHAN_PUT_REF_KIND = 'orphan-put';

type AttemptRow = {
  change_set_id: string;
  attempt_id: string;
  session_id: string;
  workspace_id: string;
  user_message_id: string | null;
  active_revision: number;
  capture_state: string;
  disposition: string;
};

export type TurnChangeFileActionRecord = {
  actionId: string;
  runId: string;
  toolCallId: string | null;
  actionOrdinal: number;
  relativePath: string;
  beforeSha: string | null;
  afterSha: string | null;
  beforeExists: boolean;
  afterExists: boolean;
  settlement: string;
};

type FileActionRow = {
  action_id: string;
  run_id: string;
  tool_call_id: string | null;
  action_ordinal: number;
  relative_path: string;
  before_sha: string | null;
  after_sha: string | null;
  before_exists: number;
  after_exists: number;
  settlement: string;
};

export type TurnChangeRunSegmentRecord = {
  runId: string;
  attemptId: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
};

type RunSegmentRow = {
  run_id: string;
  attempt_id: string;
  source: string;
  started_at: string;
  ended_at: string | null;
};

const FILE_ACTION_REF_KIND = 'file-action';

export type TurnChangeStore = {
  putObject(bytes: Uint8Array): Promise<{ sha256: string; byteLength: number }>;
  getObject(sha256: string): Promise<Uint8Array>;
  pinObject(input: { sha256: string; refKind: string; refId: string; pinUntil?: string }): void;
  registerWorkspace(input: {
    workspaceId: string;
    rootPath: string;
    hostInstanceId: string;
    gitDir?: string;
    worktreePath?: string;
  }): void;
  createAttempt(input: {
    changeSetId: string;
    attemptId: string;
    sessionId: string;
    workspaceId: string;
    userMessageId?: string | null;
  }): void;
  getAttempt(changeSetId: string): {
    changeSetId: string;
    attemptId: string;
    sessionId: string;
    workspaceId: string;
    userMessageId: string | null;
    activeRevision: number;
    captureState: string;
    disposition: string;
  } | undefined;
  recordFileAction(input: TurnChangeFileActionRecord): void;
  listFileActionsByRun(runId: string): TurnChangeFileActionRecord[];
  markAttemptCaptureState(changeSetId: string, captureState: string): void;
  beginRunSegment(input: {
    runId: string;
    attemptId: string;
    source: string;
    startedAt?: string;
  }): void;
  endRunSegment(runId: string, endedAt?: string): void;
  listRunIdsByAttempt(attemptId: string): string[];
  getRunSegment(runId: string): TurnChangeRunSegmentRecord | undefined;
  close(): void;
};

export function openTurnChangeStore(options: { rootDir: string }): TurnChangeStore {
  mkdirSync(options.rootDir, { recursive: true });
  const db = new DatabaseSync(join(options.rootDir, TURN_CHANGE_DATABASE_FILENAME));
  try {
    migrateTurnChangeSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const objects = createTurnChangeObjectStore({ rootDir: options.rootDir });
  const insertOrphanRef = db.prepare(
    `INSERT OR IGNORE INTO object_ref(sha256, ref_kind, ref_id, pin_until)
     VALUES (?, ?, ?, NULL)`,
  );
  const upsertPin = db.prepare(
    `INSERT INTO object_ref(sha256, ref_kind, ref_id, pin_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(sha256, ref_kind, ref_id) DO UPDATE SET pin_until = excluded.pin_until`,
  );
  const upsertWorkspace = db.prepare(
    `INSERT INTO workspace(
       workspace_id, root_path, git_dir, worktree_path, host_instance_id, revision
     ) VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(workspace_id) DO UPDATE SET
       root_path = excluded.root_path,
       git_dir = excluded.git_dir,
       worktree_path = excluded.worktree_path,
       host_instance_id = excluded.host_instance_id`,
  );
  const insertAttempt = db.prepare(
    `INSERT INTO attempt(
       change_set_id, attempt_id, session_id, workspace_id, user_message_id,
       active_revision, capture_state, disposition
     ) VALUES (?, ?, ?, ?, ?, 0, 'collecting', 'applied')`,
  );
  const selectAttempt = db.prepare('SELECT * FROM attempt WHERE change_set_id = ?');
  const selectFileActionByUnique = db.prepare(
    `SELECT * FROM file_action
     WHERE run_id = ? AND tool_call_id IS ? AND action_ordinal = ?`,
  );
  const insertFileAction = db.prepare(
    `INSERT INTO file_action(
       action_id, run_id, tool_call_id, action_ordinal, relative_path,
       before_sha, after_sha, before_exists, after_exists, settlement
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectFileActionsByRun = db.prepare(
    `SELECT * FROM file_action WHERE run_id = ? ORDER BY rowid ASC`,
  );
  const updateAttemptCaptureState = db.prepare(
    `UPDATE attempt SET capture_state = ? WHERE change_set_id = ?`,
  );
  const insertRunSegment = db.prepare(
    `INSERT OR IGNORE INTO run_segment(run_id, attempt_id, source, started_at, ended_at)
     VALUES (?, ?, ?, ?, NULL)`,
  );
  const updateRunSegmentEndedAt = db.prepare(
    `UPDATE run_segment SET ended_at = ? WHERE run_id = ? AND ended_at IS NULL`,
  );
  const selectRunIdsByAttempt = db.prepare(
    `SELECT run_id FROM run_segment WHERE attempt_id = ? ORDER BY rowid ASC`,
  );
  const selectRunSegment = db.prepare(`SELECT * FROM run_segment WHERE run_id = ?`);
  const persistFileAction = (input: TurnChangeFileActionRecord): void => {
    const existing = selectFileActionByUnique.get(
      input.runId,
      input.toolCallId,
      input.actionOrdinal,
    ) as FileActionRow | undefined;
    if (existing) {
      return;
    }
    db.exec('BEGIN');
    try {
      const raced = selectFileActionByUnique.get(
        input.runId,
        input.toolCallId,
        input.actionOrdinal,
      ) as FileActionRow | undefined;
      if (raced) {
        db.exec('ROLLBACK');
        return;
      }
      insertFileAction.run(
        input.actionId,
        input.runId,
        input.toolCallId,
        input.actionOrdinal,
        input.relativePath,
        input.beforeSha,
        input.afterSha,
        input.beforeExists ? 1 : 0,
        input.afterExists ? 1 : 0,
        input.settlement,
      );
      if (input.beforeSha) {
        upsertPin.run(input.beforeSha, FILE_ACTION_REF_KIND, input.actionId, null);
      }
      if (input.afterSha) {
        upsertPin.run(input.afterSha, FILE_ACTION_REF_KIND, input.actionId, null);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      const duplicate = selectFileActionByUnique.get(
        input.runId,
        input.toolCallId,
        input.actionOrdinal,
      ) as FileActionRow | undefined;
      if (duplicate) {
        return;
      }
      throw error;
    }
  };

  return {
    async putObject(bytes: Uint8Array): Promise<{ sha256: string; byteLength: number }> {
      const put = await objects.put(bytes);
      insertOrphanRef.run(put.sha256, ORPHAN_PUT_REF_KIND, put.sha256);
      return put;
    },

    getObject(sha256: string): Promise<Uint8Array> {
      return objects.get(sha256);
    },

    pinObject(input: { sha256: string; refKind: string; refId: string; pinUntil?: string }): void {
      upsertPin.run(input.sha256, input.refKind, input.refId, input.pinUntil ?? null);
    },

    registerWorkspace(input: {
      workspaceId: string;
      rootPath: string;
      hostInstanceId: string;
      gitDir?: string;
      worktreePath?: string;
    }): void {
      upsertWorkspace.run(
        input.workspaceId,
        input.rootPath,
        input.gitDir ?? null,
        input.worktreePath ?? null,
        input.hostInstanceId,
      );
    },

    createAttempt(input: {
      changeSetId: string;
      attemptId: string;
      sessionId: string;
      workspaceId: string;
      userMessageId?: string | null;
    }): void {
      insertAttempt.run(
        input.changeSetId,
        input.attemptId,
        input.sessionId,
        input.workspaceId,
        input.userMessageId ?? null,
      );
    },

    getAttempt(changeSetId: string) {
      const row = selectAttempt.get(changeSetId) as AttemptRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      return {
        changeSetId: row.change_set_id,
        attemptId: row.attempt_id,
        sessionId: row.session_id,
        workspaceId: row.workspace_id,
        userMessageId: row.user_message_id,
        activeRevision: row.active_revision,
        captureState: row.capture_state,
        disposition: row.disposition,
      };
    },

    recordFileAction(input: TurnChangeFileActionRecord): void {
      persistFileAction(input);
    },

    listFileActionsByRun(runId: string): TurnChangeFileActionRecord[] {
      const rows = selectFileActionsByRun.all(runId) as FileActionRow[];
      return rows.map(mapFileActionRow);
    },

    markAttemptCaptureState(changeSetId: string, captureState: string): void {
      updateAttemptCaptureState.run(captureState, changeSetId);
    },

    beginRunSegment(input: {
      runId: string;
      attemptId: string;
      source: string;
      startedAt?: string;
    }): void {
      insertRunSegment.run(
        input.runId,
        input.attemptId,
        input.source,
        input.startedAt ?? new Date().toISOString(),
      );
    },

    endRunSegment(runId: string, endedAt?: string): void {
      updateRunSegmentEndedAt.run(endedAt ?? new Date().toISOString(), runId);
    },

    listRunIdsByAttempt(attemptId: string): string[] {
      const rows = selectRunIdsByAttempt.all(attemptId) as Array<{ run_id: string }>;
      return rows.map((row) => row.run_id);
    },

    getRunSegment(runId: string): TurnChangeRunSegmentRecord | undefined {
      const row = selectRunSegment.get(runId) as RunSegmentRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      return {
        runId: row.run_id,
        attemptId: row.attempt_id,
        source: row.source,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      };
    },

    close(): void {
      db.close();
    },
  };
}

function mapFileActionRow(row: FileActionRow): TurnChangeFileActionRecord {
  return {
    actionId: row.action_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    actionOrdinal: row.action_ordinal,
    relativePath: row.relative_path,
    beforeSha: row.before_sha,
    afterSha: row.after_sha,
    beforeExists: row.before_exists === 1,
    afterExists: row.after_exists === 1,
    settlement: row.settlement,
  };
}

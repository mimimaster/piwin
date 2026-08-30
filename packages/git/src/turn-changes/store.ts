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

    close(): void {
      db.close();
    },
  };
}

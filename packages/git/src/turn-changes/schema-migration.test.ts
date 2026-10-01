import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { migrateTurnChangeSchema } from './schema.js';

describe('turn-change schema migration', () => {
  it('adds the overlapping-paths column to a store created before it existed', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE change_version_note (
      change_set_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      incomplete_reason TEXT,
      excluded_paths_json TEXT NOT NULL,
      sealed_at TEXT NOT NULL,
      PRIMARY KEY(change_set_id, revision)
    )`);
    db.prepare(
      `INSERT INTO change_version_note VALUES ('cs', 1, NULL, '["gen.txt"]', '2026-09-29T00:00:00.000Z')`,
    ).run();

    migrateTurnChangeSchema(db);
    migrateTurnChangeSchema(db);

    const row = db.prepare(`SELECT * FROM change_version_note`).get() as {
      excluded_paths_json: string;
      overlapping_paths_json: string;
    };
    expect(row.excluded_paths_json).toBe('["gen.txt"]');
    expect(row.overlapping_paths_json).toBe('[]');
    db.close();
  });

  it('adds the origin, command-only and skipped-paths columns to older tables', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE file_action (
      action_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tool_call_id TEXT, action_ordinal INTEGER NOT NULL,
      relative_path TEXT NOT NULL, before_sha TEXT, after_sha TEXT, before_exists INTEGER NOT NULL,
      after_exists INTEGER NOT NULL, settlement TEXT NOT NULL, UNIQUE(run_id, tool_call_id, action_ordinal)
    )`);
    db.exec(`CREATE TABLE change_file (
      change_set_id TEXT NOT NULL, revision INTEGER NOT NULL, file_id TEXT NOT NULL, relative_path TEXT NOT NULL,
      kind TEXT NOT NULL, before_sha TEXT, after_sha TEXT, PRIMARY KEY(change_set_id, revision, file_id)
    )`);
    db.exec(`CREATE TABLE operation_note (
      operation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, reason TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0
    )`);
    db.prepare(`INSERT INTO file_action VALUES ('a', 'r', 't', 0, 'x.ts', NULL, NULL, 0, 1, 'applied')`).run();
    db.prepare(`INSERT INTO change_file VALUES ('cs', 1, 'f', 'x.ts', 'added', NULL, NULL)`).run();
    db.prepare(`INSERT INTO operation_note(operation_id, workspace_id, created_at, updated_at) VALUES ('o', 'w', 't', 't')`).run();

    migrateTurnChangeSchema(db);

    expect(db.prepare(`SELECT origin FROM file_action`).get()).toEqual({ origin: 'host' });
    expect(db.prepare(`SELECT command_only FROM change_file`).get()).toEqual({ command_only: 0 });
    expect(db.prepare(`SELECT skipped_paths_json FROM operation_note`).get()).toEqual({ skipped_paths_json: '[]' });
    db.close();
  });
});

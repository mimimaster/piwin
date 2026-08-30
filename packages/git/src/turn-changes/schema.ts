/**
 * Turn-change metadata schema v1. Runtime sqlite stays in store.ts.
 */
import type { DatabaseSync } from 'node:sqlite';

export const TURN_CHANGE_SCHEMA_VERSION = 1;
export const TURN_CHANGE_DATABASE_FILENAME = 'turn-changes.sqlite3';

export const TURN_CHANGE_PRAGMAS = [
  'PRAGMA journal_mode=WAL',
  'PRAGMA foreign_keys=ON',
  'PRAGMA busy_timeout=5000',
  'PRAGMA synchronous=FULL',
].join('; ');

export const TURN_CHANGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  schema_version INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS workspace (
  workspace_id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  git_dir TEXT,
  worktree_path TEXT,
  host_instance_id TEXT NOT NULL,
  revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempt (
  change_set_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_message_id TEXT,
  active_revision INTEGER NOT NULL,
  capture_state TEXT NOT NULL,
  disposition TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_segment (
  run_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS file_action (
  action_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_call_id TEXT,
  action_ordinal INTEGER NOT NULL,
  relative_path TEXT NOT NULL,
  before_sha TEXT,
  after_sha TEXT,
  before_exists INTEGER NOT NULL,
  after_exists INTEGER NOT NULL,
  settlement TEXT NOT NULL,
  UNIQUE(run_id, tool_call_id, action_ordinal)
);
CREATE TABLE IF NOT EXISTS change_version (
  change_set_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  file_count INTEGER,
  additions INTEGER,
  deletions INTEGER,
  binary_file_count INTEGER NOT NULL,
  coverage_complete INTEGER NOT NULL,
  PRIMARY KEY(change_set_id, revision)
);
CREATE TABLE IF NOT EXISTS change_file (
  change_set_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  before_sha TEXT,
  after_sha TEXT,
  PRIMARY KEY(change_set_id, revision, file_id)
);
CREATE TABLE IF NOT EXISTS operation (
  operation_id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  direction TEXT
);
CREATE TABLE IF NOT EXISTS idempotency (
  principal TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  PRIMARY KEY(principal, key)
);
CREATE TABLE IF NOT EXISTS object_ref (
  sha256 TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  pin_until TEXT,
  PRIMARY KEY(sha256, ref_kind, ref_id)
);
`;

export function readTurnChangeUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

export function migrateTurnChangeSchema(db: DatabaseSync): void {
  const userVersion = readTurnChangeUserVersion(db);
  if (userVersion > TURN_CHANGE_SCHEMA_VERSION) {
    throw new Error(`unsupported turn-change schema user_version ${userVersion}`);
  }
  db.exec(TURN_CHANGE_PRAGMAS);
  db.exec(TURN_CHANGE_SCHEMA_SQL);
  db.exec(`INSERT OR IGNORE INTO meta(schema_version) VALUES (${TURN_CHANGE_SCHEMA_VERSION})`);
  db.exec(`PRAGMA user_version=${TURN_CHANGE_SCHEMA_VERSION}`);
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { TURN_CHANGE_DATABASE_FILENAME } from './schema.js';
import { openTurnChangeStore } from './store.js';

const temporaryDirectories: string[] = [];

async function createRootDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-turn-change-store-'));
  temporaryDirectories.push(directory);
  return directory;
}

function databasePath(rootDir: string): string {
  return join(rootDir, TURN_CHANGE_DATABASE_FILENAME);
}

function readUserVersion(rootDir: string): number {
  const db = new DatabaseSync(databasePath(rootDir));
  try {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    return row?.user_version ?? 0;
  } finally {
    db.close();
  }
}

function readAttemptRow(rootDir: string, changeSetId: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(databasePath(rootDir));
  try {
    return db.prepare('SELECT * FROM attempt WHERE change_set_id = ?').get(changeSetId) as
      | Record<string, unknown>
      | undefined;
  } finally {
    db.close();
  }
}

function readObjectRefs(rootDir: string, sha256: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(databasePath(rootDir));
  try {
    return db.prepare('SELECT * FROM object_ref WHERE sha256 = ? ORDER BY ref_kind, ref_id').all(sha256) as Array<
      Record<string, unknown>
    >;
  } finally {
    db.close();
  }
}

describe('openTurnChangeStore', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('creates an attempt with collecting/applied defaults and SQL NULL userMessageId', async () => {
    const rootDir = await createRootDir();
    const store = openTurnChangeStore({ rootDir });

    store.createAttempt({
      changeSetId: 'cs-1',
      attemptId: 'att-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    store.createAttempt({
      changeSetId: 'cs-2',
      attemptId: 'att-2',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      userMessageId: null,
    });

    expect(store.getAttempt('cs-1')).toEqual({
      changeSetId: 'cs-1',
      attemptId: 'att-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      userMessageId: null,
      activeRevision: 0,
      captureState: 'collecting',
      disposition: 'applied',
    });
    expect(store.getAttempt('cs-2')).toMatchObject({ userMessageId: null });
    expect(store.getAttempt('missing')).toBeUndefined();

    const row = readAttemptRow(rootDir, 'cs-1');
    expect(row?.user_message_id).toBeNull();
    expect(row?.active_revision).toBe(0);
    expect(row?.capture_state).toBe('collecting');
    expect(row?.disposition).toBe('applied');
    expect(readUserVersion(rootDir)).toBe(1);

    store.close();
  });

  it('puts bytes to CAS then records an orphan-put pin row', async () => {
    const rootDir = await createRootDir();
    const store = openTurnChangeStore({ rootDir });
    const bytes = new TextEncoder().encode('turn-change-bytes');

    const put = await store.putObject(bytes);
    expect(put.byteLength).toBe(bytes.byteLength);
    expect(await store.getObject(put.sha256)).toEqual(bytes);

    store.pinObject({
      sha256: put.sha256,
      refKind: 'test-pin',
      refId: 'file-1',
      pinUntil: '2026-12-01T00:00:00.000Z',
    });
    store.close();

    expect(readObjectRefs(rootDir, put.sha256)).toEqual([
      {
        sha256: put.sha256,
        ref_kind: 'orphan-put',
        ref_id: put.sha256,
        pin_until: null,
      },
      {
        sha256: put.sha256,
        ref_kind: 'test-pin',
        ref_id: 'file-1',
        pin_until: '2026-12-01T00:00:00.000Z',
      },
    ]);
  });

  it('reopens the same rootDir with attempt and object bytes intact', async () => {
    const rootDir = await createRootDir();
    const first = openTurnChangeStore({ rootDir });
    first.registerWorkspace({
      workspaceId: 'ws-1',
      rootPath: '/tmp/project',
      hostInstanceId: 'host-1',
      gitDir: '/tmp/project/.git',
    });
    first.createAttempt({
      changeSetId: 'cs-persist',
      attemptId: 'att-persist',
      sessionId: 'sess-persist',
      workspaceId: 'ws-1',
      userMessageId: 'um-1',
    });
    const bytes = new TextEncoder().encode('persisted-object');
    const put = await first.putObject(bytes);
    first.close();

    const second = openTurnChangeStore({ rootDir });
    expect(second.getAttempt('cs-persist')).toEqual({
      changeSetId: 'cs-persist',
      attemptId: 'att-persist',
      sessionId: 'sess-persist',
      workspaceId: 'ws-1',
      userMessageId: 'um-1',
      activeRevision: 0,
      captureState: 'collecting',
      disposition: 'applied',
    });
    expect(await second.getObject(put.sha256)).toEqual(bytes);
    second.close();
  });

  it('refuses to open a database with a newer user_version', async () => {
    const rootDir = await createRootDir();
    const store = openTurnChangeStore({ rootDir });
    store.close();

    const raw = new DatabaseSync(databasePath(rootDir));
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    expect(() => openTurnChangeStore({ rootDir })).toThrow(/user_version|schema version|unsupported/i);
  });

  it('records a file_action, pins CAS objects, and lists by run', async () => {
    const rootDir = await createRootDir();
    const store = openTurnChangeStore({ rootDir });
    const before = new TextEncoder().encode('before\n');
    const after = new TextEncoder().encode('after\n');
    const beforePut = await store.putObject(before);
    const afterPut = await store.putObject(after);

    store.recordFileAction({
      actionId: 'action-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      actionOrdinal: 0,
      relativePath: 'src/a.ts',
      beforeSha: beforePut.sha256,
      afterSha: afterPut.sha256,
      beforeExists: true,
      afterExists: true,
      settlement: 'applied',
    });

    expect(store.listFileActionsByRun('run-1')).toEqual([
      {
        actionId: 'action-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        actionOrdinal: 0,
        relativePath: 'src/a.ts',
        beforeSha: beforePut.sha256,
        afterSha: afterPut.sha256,
        beforeExists: true,
        afterExists: true,
        settlement: 'applied',
      },
    ]);
    expect(readObjectRefs(rootDir, beforePut.sha256)).toEqual(
      expect.arrayContaining([
        {
          sha256: beforePut.sha256,
          ref_kind: 'file-action',
          ref_id: 'action-1',
          pin_until: null,
        },
      ]),
    );
    expect(readObjectRefs(rootDir, afterPut.sha256)).toEqual(
      expect.arrayContaining([
        {
          sha256: afterPut.sha256,
          ref_kind: 'file-action',
          ref_id: 'action-1',
          pin_until: null,
        },
      ]),
    );
    store.close();
  });

  it('returns the existing file_action row for a duplicate unique key', async () => {
    const rootDir = await createRootDir();
    const store = openTurnChangeStore({ rootDir });
    const first = await store.putObject(new TextEncoder().encode('first\n'));
    const second = await store.putObject(new TextEncoder().encode('second\n'));

    store.recordFileAction({
      actionId: 'action-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      actionOrdinal: 0,
      relativePath: 'src/a.ts',
      beforeSha: null,
      afterSha: first.sha256,
      beforeExists: false,
      afterExists: true,
      settlement: 'applied',
    });
    store.recordFileAction({
      actionId: 'action-2',
      runId: 'run-1',
      toolCallId: 'tool-1',
      actionOrdinal: 0,
      relativePath: 'src/b.ts',
      beforeSha: null,
      afterSha: second.sha256,
      beforeExists: false,
      afterExists: true,
      settlement: 'failed',
    });

    expect(store.listFileActionsByRun('run-1')).toEqual([
      {
        actionId: 'action-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        actionOrdinal: 0,
        relativePath: 'src/a.ts',
        beforeSha: null,
        afterSha: first.sha256,
        beforeExists: false,
        afterExists: true,
        settlement: 'applied',
      },
    ]);
    store.close();
  });

  it('markAttemptCaptureState updates an existing attempt', async () => {
    const rootDir = await createRootDir();
    const store = openTurnChangeStore({ rootDir });
    store.createAttempt({
      changeSetId: 'cs-1',
      attemptId: 'att-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });

    store.markAttemptCaptureState('cs-1', 'incomplete');
    expect(store.getAttempt('cs-1')?.captureState).toBe('incomplete');
    store.close();
  });

  it('records run segments and lists runIds for an attempt', async () => {
    const rootDir = await createRootDir();
    const store = openTurnChangeStore({ rootDir });
    store.createAttempt({
      changeSetId: 'cs-1',
      attemptId: 'att-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });

    store.beginRunSegment({
      runId: 'run-1',
      attemptId: 'att-1',
      source: 'prompt',
      startedAt: '2026-08-30T00:00:00.000Z',
    });
    store.beginRunSegment({
      runId: 'run-2',
      attemptId: 'att-1',
      source: 'resume',
      startedAt: '2026-08-30T00:01:00.000Z',
    });
    store.endRunSegment('run-1', '2026-08-30T00:00:30.000Z');

    expect(store.listRunIdsByAttempt('att-1')).toEqual(['run-1', 'run-2']);
    expect(store.getRunSegment('run-1')).toEqual({
      runId: 'run-1',
      attemptId: 'att-1',
      source: 'prompt',
      startedAt: '2026-08-30T00:00:00.000Z',
      endedAt: '2026-08-30T00:00:30.000Z',
    });
    expect(store.getRunSegment('run-2')).toMatchObject({
      runId: 'run-2',
      source: 'resume',
      endedAt: null,
    });
    expect(store.listRunIdsByAttempt('missing')).toEqual([]);
    store.close();
  });

  it('creates additive operation_file without bumping user_version', async () => {
    const rootDir = await createRootDir();
    const store = openTurnChangeStore({ rootDir });
    store.close();

    const db = new DatabaseSync(databasePath(rootDir));
    try {
      const table = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operation_file'`)
        .get() as { name: string } | undefined;
      expect(table?.name).toBe('operation_file');
      expect(readUserVersion(rootDir)).toBe(1);
    } finally {
      db.close();
    }
  });
});

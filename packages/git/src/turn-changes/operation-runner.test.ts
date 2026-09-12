import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTurnChangeObjectStore } from './object-store.js';
import { planUndoRedo } from './operation-plan.js';
import { runTurnChangeOperation } from './operation-runner.js';
import { openTurnChangeStore } from './store.js';

const temporaryDirectories: string[] = [];
const text = new TextEncoder();

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createHarness(): Promise<{
  workspaceRoot: string;
  store: ReturnType<typeof openTurnChangeStore>;
  objectStore: ReturnType<typeof createTurnChangeObjectStore>;
}> {
  const workspaceRoot = await createTempDir('piwin-turn-change-op-ws-');
  const storeRoot = await createTempDir('piwin-turn-change-op-store-');
  const store = openTurnChangeStore({ rootDir: storeRoot });
  const objectStore = createTurnChangeObjectStore({ rootDir: storeRoot });
  store.createAttempt({
    changeSetId: 'cs-1',
    attemptId: 'att-1',
    sessionId: 'sess-1',
    workspaceId: 'ws-1',
  });
  return { workspaceRoot, store, objectStore };
}

async function put(objectStore: ReturnType<typeof createTurnChangeObjectStore>, value: string) {
  const bytes = text.encode(value);
  const putResult = await objectStore.put(bytes);
  return { bytes, sha256: putResult.sha256 };
}

describe('runTurnChangeOperation', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('undo restores recorded before bytes and sets disposition undone', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const before = await put(objectStore, 'before\n');
    const after = await put(objectStore, 'after\n');
    await mkdir(join(workspaceRoot, 'src'));
    await writeFile(join(workspaceRoot, 'src/a.ts'), after.bytes);

    const result = await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'user-1',
      idempotencyKey: 'undo-1',
      requestHash: 'hash-undo-1',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      files: planUndoRedo({
        files: [
          {
            relativePath: 'src/a.ts',
            beforeSha: before.sha256,
            afterSha: after.sha256,
            beforeExists: true,
            afterExists: true,
          },
        ],
        direction: 'undo',
      }),
    });

    expect(result).toMatchObject({ status: 'succeeded', replayed: false });
    expect(await readFile(join(workspaceRoot, 'src/a.ts'))).toEqual(Buffer.from(before.bytes));
    expect(store.getAttempt('cs-1')?.disposition).toBe('undone');
    expect(store.getOperation(result.operationId)?.status).toBe('succeeded');
    store.close();
  });

  it('redo restores recorded after bytes of the undone version', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const before = await put(objectStore, 'before\n');
    const after = await put(objectStore, 'after\n');
    await writeFile(join(workspaceRoot, 'note.txt'), after.bytes);
    const files = [
      {
        relativePath: 'note.txt',
        beforeSha: before.sha256,
        afterSha: after.sha256,
        beforeExists: true,
        afterExists: true,
      },
    ];

    await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'user-1',
      idempotencyKey: 'undo-1',
      requestHash: 'hash-undo-1',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      files: planUndoRedo({ files, direction: 'undo' }),
    });
    const redo = await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'user-1',
      idempotencyKey: 'redo-1',
      requestHash: 'hash-redo-1',
      changeSetId: 'cs-1',
      kind: 'redo',
      expectedRevision: 1,
      files: planUndoRedo({ files, direction: 'redo' }),
    });

    expect(redo.status).toBe('succeeded');
    expect(await readFile(join(workspaceRoot, 'note.txt'))).toEqual(Buffer.from(after.bytes));
    expect(store.getAttempt('cs-1')?.disposition).toBe('applied');
    store.close();
  });

  it('rejects overlapping external edits with files-changed and zero writes', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const beforeA = await put(objectStore, 'a-before\n');
    const afterA = await put(objectStore, 'a-after\n');
    const beforeB = await put(objectStore, 'b-before\n');
    const afterB = await put(objectStore, 'b-after\n');
    await writeFile(join(workspaceRoot, 'a.ts'), afterA.bytes);
    await writeFile(join(workspaceRoot, 'b.ts'), afterB.bytes);
    await writeFile(join(workspaceRoot, 'a.ts'), text.encode('externally-edited\n'));

    const result = await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'user-1',
      idempotencyKey: 'undo-overlap',
      requestHash: 'hash-overlap',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      files: planUndoRedo({
        files: [
          {
            relativePath: 'a.ts',
            beforeSha: beforeA.sha256,
            afterSha: afterA.sha256,
            beforeExists: true,
            afterExists: true,
          },
          {
            relativePath: 'b.ts',
            beforeSha: beforeB.sha256,
            afterSha: afterB.sha256,
            beforeExists: true,
            afterExists: true,
          },
        ],
        direction: 'undo',
      }),
    });

    expect(result).toMatchObject({
      status: 'rejected',
      replayed: false,
      reason: 'files-changed',
      affectedPaths: ['a.ts'],
    });
    expect(await readFile(join(workspaceRoot, 'a.ts'), 'utf8')).toBe('externally-edited\n');
    expect(await readFile(join(workspaceRoot, 'b.ts'))).toEqual(Buffer.from(afterB.bytes));
    expect(store.getAttempt('cs-1')?.disposition).toBe('applied');
    store.close();
  });

  it('replays the same principal+key+requestHash with zero writes', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const before = await put(objectStore, 'before\n');
    const after = await put(objectStore, 'after\n');
    await writeFile(join(workspaceRoot, 'note.txt'), after.bytes);
    const input = {
      workspaceRoot,
      store,
      objectStore,
      principal: 'user-1',
      idempotencyKey: 'undo-replay',
      requestHash: 'hash-replay',
      changeSetId: 'cs-1',
      kind: 'undo' as const,
      expectedRevision: 1,
      files: planUndoRedo({
        files: [
          {
            relativePath: 'note.txt',
            beforeSha: before.sha256,
            afterSha: after.sha256,
            beforeExists: true,
            afterExists: true,
          },
        ],
        direction: 'undo',
      }),
    };

    const first = await runTurnChangeOperation(input);
    await writeFile(join(workspaceRoot, 'note.txt'), text.encode('mutated-after-undo\n'));
    const second = await runTurnChangeOperation(input);

    expect(second.operationId).toBe(first.operationId);
    expect(second.replayed).toBe(true);
    expect(await readFile(join(workspaceRoot, 'note.txt'), 'utf8')).toBe('mutated-after-undo\n');
    store.close();
  });

  it('rejects the same key with a different requestHash and writes nothing', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const before = await put(objectStore, 'before\n');
    const after = await put(objectStore, 'after\n');
    await writeFile(join(workspaceRoot, 'note.txt'), after.bytes);
    const files = planUndoRedo({
      files: [
        {
          relativePath: 'note.txt',
          beforeSha: before.sha256,
          afterSha: after.sha256,
          beforeExists: true,
          afterExists: true,
        },
      ],
      direction: 'undo',
    });

    await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'user-1',
      idempotencyKey: 'undo-conflict',
      requestHash: 'hash-1',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      files,
    });
    await expect(
      runTurnChangeOperation({
        workspaceRoot,
        store,
        objectStore,
        principal: 'user-1',
        idempotencyKey: 'undo-conflict',
        requestHash: 'hash-2',
        changeSetId: 'cs-1',
        kind: 'undo',
        expectedRevision: 1,
        files,
      }),
    ).rejects.toThrow(/idempotency-conflict/);
    expect(await readFile(join(workspaceRoot, 'note.txt'))).toEqual(Buffer.from(before.bytes));
    store.close();
  });

  it('records a succeeded operation for an empty plan', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const result = await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'user-1',
      idempotencyKey: 'undo-empty',
      requestHash: 'hash-empty',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      files: [],
    });

    expect(result.status).toBe('succeeded');
    expect(result.replayed).toBe(false);
    expect(store.getOperation(result.operationId)).toMatchObject({
      kind: 'undo',
      status: 'succeeded',
      expectedRevision: 1,
    });
    expect(store.getAttempt('cs-1')?.disposition).toBe('undone');
    store.close();
  });

  it('undo deletes a created file and restores a deleted file', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const created = await put(objectStore, 'created\n');
    const removed = await put(objectStore, 'removed\n');
    await writeFile(join(workspaceRoot, 'created.txt'), created.bytes);

    const result = await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'user-1',
      idempotencyKey: 'undo-create-delete',
      requestHash: 'hash-create-delete',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      files: planUndoRedo({
        files: [
          {
            relativePath: 'created.txt',
            beforeSha: null,
            afterSha: created.sha256,
            beforeExists: false,
            afterExists: true,
          },
          {
            relativePath: 'removed.txt',
            beforeSha: removed.sha256,
            afterSha: null,
            beforeExists: true,
            afterExists: false,
          },
        ],
        direction: 'undo',
      }),
    });

    expect(result.status).toBe('succeeded');
    await expect(stat(join(workspaceRoot, 'created.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(workspaceRoot, 'removed.txt'))).toEqual(Buffer.from(removed.bytes));
    store.close();
  });

  it('same apply fingerprint replays one operation id', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const before = await put(objectStore, 'before\n');
    const after = await put(objectStore, 'after\n');
    await writeFile(join(workspaceRoot, 'note.txt'), before.bytes);
    const input = {
      workspaceRoot,
      store,
      objectStore,
      principal: 'host',
      idempotencyKey: 'subagent-apply-replay',
      requestHash: 'hash-subagent-apply-replay',
      changeSetId: 'cs-1',
      kind: 'subagent-apply' as const,
      expectedRevision: 1,
      resultId: 'result-1',
      files: planUndoRedo({
        files: [
          {
            relativePath: 'note.txt',
            beforeSha: before.sha256,
            afterSha: after.sha256,
            beforeExists: true,
            afterExists: true,
          },
        ],
        direction: 'redo',
      }),
    };

    const first = await runTurnChangeOperation(input);
    await writeFile(join(workspaceRoot, 'note.txt'), text.encode('mutated-after-apply\n'));
    const second = await runTurnChangeOperation(input);

    expect(first.status).toBe('succeeded');
    expect(second.operationId).toBe(first.operationId);
    expect(second.replayed).toBe(true);
    expect(await readFile(join(workspaceRoot, 'note.txt'), 'utf8')).toBe('mutated-after-apply\n');
    store.close();
  });

  it('restart after file write reconciles success without a second write', async () => {
    const workspaceRoot = await createTempDir('piwin-turn-change-op-ws-');
    const storeRoot = await createTempDir('piwin-turn-change-op-store-');
    const firstStore = openTurnChangeStore({ rootDir: storeRoot });
    const objectStore = createTurnChangeObjectStore({ rootDir: storeRoot });
    firstStore.createAttempt({
      changeSetId: 'cs-1',
      attemptId: 'att-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    const before = await put(objectStore, 'before\n');
    const after = await put(objectStore, 'after\n');
    await writeFile(join(workspaceRoot, 'note.txt'), before.bytes);

    const first = await runTurnChangeOperation({
      workspaceRoot,
      store: firstStore,
      objectStore,
      principal: 'host',
      idempotencyKey: 'subagent-apply-written',
      requestHash: 'hash-subagent-apply-written',
      changeSetId: 'cs-1',
      kind: 'subagent-apply',
      expectedRevision: 1,
      resultId: 'result-1',
      files: planUndoRedo({
        files: [
          {
            relativePath: 'note.txt',
            beforeSha: before.sha256,
            afterSha: after.sha256,
            beforeExists: true,
            afterExists: true,
          },
        ],
        direction: 'redo',
      }),
    });
    firstStore.updateOperationStatus(first.operationId, 'applying');
    firstStore.close();

    const restarted = openTurnChangeStore({ rootDir: storeRoot });
    const files = restarted.listOperationFiles(first.operationId);
    expect(files.every((file) => file.status === 'verified')).toBe(true);
    restarted.updateOperationStatus(first.operationId, 'succeeded');
    await writeFile(join(workspaceRoot, 'note.txt'), text.encode('keep-reconciled\n'));

    const replay = await runTurnChangeOperation({
      workspaceRoot,
      store: restarted,
      objectStore,
      principal: 'host',
      idempotencyKey: 'subagent-apply-written',
      requestHash: 'hash-subagent-apply-written',
      changeSetId: 'cs-1',
      kind: 'subagent-apply',
      expectedRevision: 1,
      resultId: 'result-1',
      files: planUndoRedo({
        files: [
          {
            relativePath: 'note.txt',
            beforeSha: before.sha256,
            afterSha: after.sha256,
            beforeExists: true,
            afterExists: true,
          },
        ],
        direction: 'redo',
      }),
    });

    expect(replay.operationId).toBe(first.operationId);
    expect(replay.replayed).toBe(true);
    expect(replay.status).toBe('succeeded');
    expect(await readFile(join(workspaceRoot, 'note.txt'), 'utf8')).toBe('keep-reconciled\n');
    restarted.close();
  });

  it('failed pre-write validation releases reservation; needs-repair does not', async () => {
    const { workspaceRoot, store, objectStore } = await createHarness();
    const before = await put(objectStore, 'before\n');
    const after = await put(objectStore, 'after\n');
    await writeFile(join(workspaceRoot, 'note.txt'), text.encode('externally-edited\n'));

    const rejected = await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'host',
      idempotencyKey: 'subagent-apply-reject',
      requestHash: 'hash-subagent-apply-reject',
      changeSetId: 'cs-1',
      kind: 'subagent-apply',
      expectedRevision: 1,
      resultId: 'result-1',
      candidateGroupId: 'group-1',
      files: planUndoRedo({
        files: [
          {
            relativePath: 'note.txt',
            beforeSha: before.sha256,
            afterSha: after.sha256,
            beforeExists: true,
            afterExists: true,
          },
        ],
        direction: 'redo',
      }),
    });

    expect(rejected.status).toBe('rejected');
    expect(store.getSubagentApplyReservation({ resultId: 'result-1' })).toBeUndefined();

    await writeFile(join(workspaceRoot, 'note.txt'), before.bytes);
    const retried = await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'host',
      idempotencyKey: 'subagent-apply-retry',
      requestHash: 'hash-subagent-apply-retry',
      changeSetId: 'cs-1',
      kind: 'subagent-apply',
      expectedRevision: 1,
      resultId: 'result-1',
      candidateGroupId: 'group-1',
      files: planUndoRedo({
        files: [
          {
            relativePath: 'note.txt',
            beforeSha: before.sha256,
            afterSha: after.sha256,
            beforeExists: true,
            afterExists: true,
          },
        ],
        direction: 'redo',
      }),
    });
    expect(retried.status).toBe('succeeded');
    store.updateOperationStatus(retried.operationId, 'needs-repair');
    store.releaseSubagentApplyReservation(retried.operationId);

    const blocked = await runTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      principal: 'host',
      idempotencyKey: 'subagent-apply-blocked',
      requestHash: 'hash-subagent-apply-blocked',
      changeSetId: 'cs-1',
      kind: 'subagent-apply',
      expectedRevision: 1,
      resultId: 'result-2',
      candidateGroupId: 'group-1',
      files: [],
    });
    expect(blocked).toMatchObject({
      status: 'needs-repair',
      replayed: false,
      reason: 'needs-repair',
    });
    expect(await readFile(join(workspaceRoot, 'note.txt'))).toEqual(Buffer.from(after.bytes));
    store.close();
  });
});

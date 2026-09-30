import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTurnChangeObjectStore } from './object-store.js';
import { planUndoRedo } from './operation-plan.js';
import {
  previewTurnChangeRepair,
  runTurnChangeRepair,
  verifyTurnChangeRepair,
} from './operation-repair.js';
import { runTurnChangeOperation } from './operation-runner.js';
import { openTurnChangeStore, type TurnChangeStore } from './store.js';

const directories: string[] = [];
const stores: TurnChangeStore[] = [];
const text = new TextEncoder();

async function harness() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'piwin-tc-oplog-ws-'));
  const storeRoot = await mkdtemp(join(tmpdir(), 'piwin-tc-oplog-store-'));
  directories.push(workspaceRoot, storeRoot);
  const store = openTurnChangeStore({ rootDir: storeRoot });
  stores.push(store);
  const objectStore = createTurnChangeObjectStore({ rootDir: storeRoot });
  store.createAttempt({ changeSetId: 'cs-1', attemptId: 'att-1', sessionId: 's-1', workspaceId: 'ws-1' });
  const put = async (value: string) => (await objectStore.put(text.encode(value))).sha256;
  return { workspaceRoot, store, objectStore, put };
}

function undoPlan(files: Array<{ path: string; before: string; after: string }>) {
  return planUndoRedo({
    direction: 'undo',
    files: files.map((file) => ({
      relativePath: file.path,
      beforeSha: file.before,
      afterSha: file.after,
      beforeExists: true,
      afterExists: true,
    })),
  });
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('turn-change operation record', () => {
  it('lists a workspace\'s undo/redo newest first, pages, and marks older ones superseded', async () => {
    const { workspaceRoot, store, objectStore, put } = await harness();
    const before = await put('before\n');
    const after = await put('after\n');
    await writeFile(join(workspaceRoot, 'a.txt'), 'after\n');
    const base = { workspaceRoot, store, objectStore, principal: 'host', changeSetId: 'cs-1', expectedRevision: 1, workspaceId: 'ws-1' };
    const files = [{ path: 'a.txt', before, after }];

    const undo = await runTurnChangeOperation({
      ...base, idempotencyKey: 'k1', requestHash: 'h1', kind: 'undo', files: undoPlan(files),
    });
    const redo = await runTurnChangeOperation({
      ...base, idempotencyKey: 'k2', requestHash: 'h2', kind: 'redo',
      files: planUndoRedo({ direction: 'redo', files: [{ relativePath: 'a.txt', beforeSha: before, afterSha: after, beforeExists: true, afterExists: true }] }),
    });
    expect([undo.status, redo.status]).toEqual(['succeeded', 'succeeded']);

    const first = store.listWorkspaceOperations({ workspaceId: 'ws-1', limit: 1 });
    expect(first.rows.map((row) => [row.operationId, row.kind, row.superseded])).toEqual([
      [redo.operationId, 'redo', false],
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = store.listWorkspaceOperations({ workspaceId: 'ws-1', limit: 1, cursor: first.nextCursor ?? '' });
    expect(second.rows.map((row) => [row.operationId, row.superseded, row.fileCount])).toEqual([
      [undo.operationId, true, 1],
    ]);
    expect(second.nextCursor).toBeNull();
    expect(store.listWorkspaceOperations({ workspaceId: 'other', limit: 5 }).rows).toEqual([]);
  });

  it('records the reason of a rejected undo', async () => {
    const { workspaceRoot, store, objectStore, put } = await harness();
    const before = await put('before\n');
    const after = await put('after\n');
    await writeFile(join(workspaceRoot, 'a.txt'), 'edited elsewhere\n');
    const result = await runTurnChangeOperation({
      workspaceRoot, store, objectStore, principal: 'host', idempotencyKey: 'k', requestHash: 'h',
      changeSetId: 'cs-1', kind: 'undo', expectedRevision: 1, workspaceId: 'ws-1',
      files: undoPlan([{ path: 'a.txt', before, after }]),
    });
    expect(result.reason).toBe('files-changed');
    expect(store.getOperationNote(result.operationId)?.reason).toBe('files-changed');
  });

  it('a cancel requested before the first write stops with zero writes', async () => {
    const { workspaceRoot, store, objectStore, put } = await harness();
    const before = await put('before\n');
    const after = await put('after\n');
    await writeFile(join(workspaceRoot, 'a.txt'), 'after\n');
    // Simulate the cancel arriving while the pre-check runs: flag the id the
    // store will mint by intercepting beginOperation.
    const original = store.beginOperation.bind(store);
    store.beginOperation = (input) => {
      const begun = original(input);
      store.recordOperationStart({ operationId: begun.operationId, workspaceId: 'ws-1' });
      store.requestOperationCancel(begun.operationId);
      return begun;
    };
    const result = await runTurnChangeOperation({
      workspaceRoot, store, objectStore, principal: 'host', idempotencyKey: 'k', requestHash: 'h',
      changeSetId: 'cs-1', kind: 'undo', expectedRevision: 1, workspaceId: 'ws-1',
      files: undoPlan([{ path: 'a.txt', before, after }]),
    });
    expect(result).toMatchObject({ status: 'cancelled', reason: 'cancelled' });
    expect(await readFile(join(workspaceRoot, 'a.txt'), 'utf8')).toBe('after\n');
    expect(store.getAttempt('cs-1')?.disposition).toBe('applied');
  });

  it('rolls back written files when a later write fails, leaving the workspace as before', async () => {
    const { workspaceRoot, store, objectStore, put } = await harness();
    const beforeA = await put('a-before\n');
    const afterA = await put('a-after\n');
    const beforeB = await put('b-before\n');
    const afterB = await put('b-after\n');
    await writeFile(join(workspaceRoot, 'a.txt'), 'a-after\n');
    await mkdir(join(workspaceRoot, 'locked'));
    await writeFile(join(workspaceRoot, 'locked/b.txt'), 'b-after\n');
    await chmod(join(workspaceRoot, 'locked'), 0o500);
    try {
      const result = await runTurnChangeOperation({
        workspaceRoot, store, objectStore, principal: 'host', idempotencyKey: 'k', requestHash: 'h',
        changeSetId: 'cs-1', kind: 'undo', expectedRevision: 1, workspaceId: 'ws-1',
        files: undoPlan([
          { path: 'a.txt', before: beforeA, after: afterA },
          { path: 'locked/b.txt', before: beforeB, after: afterB },
        ]),
      });
      expect(result).toMatchObject({ status: 'rolled-back', reason: 'write-failed' });
      expect(await readFile(join(workspaceRoot, 'a.txt'), 'utf8')).toBe('a-after\n');
      expect(await readFile(join(workspaceRoot, 'locked/b.txt'), 'utf8')).toBe('b-after\n');
      expect(store.getAttempt('cs-1')?.disposition).toBe('applied');
      expect(store.getOperationNote(result.operationId)?.reason).toBe('write-failed');
    } finally {
      await chmod(join(workspaceRoot, 'locked'), 0o700);
    }
  });
});

describe('turn-change repair', () => {
  async function stuckOperation() {
    const context = await harness();
    const { store, workspaceRoot, put } = context;
    const beforeA = await put('a-before\n');
    const afterA = await put('a-after\n');
    const beforeB = await put('b-before\n');
    const afterB = await put('b-after\n');
    // An undo wrote a.txt and b.txt (to = before) and could not roll back.
    await writeFile(join(workspaceRoot, 'a.txt'), 'a-before\n');
    await writeFile(join(workspaceRoot, 'b.txt'), 'b-before\n');
    store.beginOperation({
      operationId: 'op-stuck', changeSetId: 'cs-1', kind: 'undo', expectedRevision: 1,
      principal: 'host', idempotencyKey: 'k', requestHash: 'h',
    });
    store.recordOperationStart({ operationId: 'op-stuck', workspaceId: 'ws-1' });
    store.recordOperationFiles(
      [
        { path: 'a.txt', from: afterA, to: beforeA },
        { path: 'b.txt', from: afterB, to: beforeB },
      ].map((file) => ({
        operationId: 'op-stuck', relativePath: file.path, fromSha: file.from, toSha: file.to,
        backupSha: file.from, fromExists: true, toExists: true, status: 'applied',
      })),
    );
    store.updateOperationStatus('op-stuck', 'needs-repair');
    return context;
  }

  it('preview classifies paths; run restores operation content; verify lifts the block', async () => {
    const { store, workspaceRoot, objectStore } = await stuckOperation();
    await writeFile(join(workspaceRoot, 'b.txt'), 'b-after\n');

    const preview = await previewTurnChangeRepair({ workspaceRoot, store, operationId: 'op-stuck' });
    expect(preview.files).toEqual([
      { relativePath: 'a.txt', state: 'operation-content' },
      { relativePath: 'b.txt', state: 'restored' },
    ]);
    const ran = await runTurnChangeRepair({
      workspaceRoot, store, objectStore, operationId: 'op-stuck', confirmationToken: preview.confirmationToken,
    });
    expect(ran.outcome).toBe('restored');
    expect(await readFile(join(workspaceRoot, 'a.txt'), 'utf8')).toBe('a-after\n');

    const verified = await verifyTurnChangeRepair({ workspaceRoot, store, operationId: 'op-stuck' });
    expect(verified.verified).toBe(true);
    expect(store.getOperation('op-stuck')?.status).toBe('rolled-back');
  });

  it('refuses a stale preview and never overwrites foreign content', async () => {
    const { store, workspaceRoot, objectStore } = await stuckOperation();
    const preview = await previewTurnChangeRepair({ workspaceRoot, store, operationId: 'op-stuck' });
    await writeFile(join(workspaceRoot, 'a.txt'), 'someone else\n');

    const stale = await runTurnChangeRepair({
      workspaceRoot, store, objectStore, operationId: 'op-stuck', confirmationToken: preview.confirmationToken,
    });
    expect(stale.outcome).toBe('stale-preview');

    const fresh = await previewTurnChangeRepair({ workspaceRoot, store, operationId: 'op-stuck' });
    const ran = await runTurnChangeRepair({
      workspaceRoot, store, objectStore, operationId: 'op-stuck', confirmationToken: fresh.confirmationToken,
    });
    expect(ran.outcome).toBe('foreign-content');
    expect(await readFile(join(workspaceRoot, 'a.txt'), 'utf8')).toBe('someone else\n');
    expect(await readFile(join(workspaceRoot, 'b.txt'), 'utf8')).toBe('b-after\n');
    expect((await verifyTurnChangeRepair({ workspaceRoot, store, operationId: 'op-stuck' })).verified).toBe(false);
    expect(store.getOperation('op-stuck')?.status).toBe('needs-repair');
  });
});

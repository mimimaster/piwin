import { mkdtemp, readdir, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTurnChangeObjectStore, type TurnChangeObjectStore } from './object-store.js';
import { sweepTurnChangeRetention } from './retention.js';
import { openTurnChangeStore, type TurnChangeStore } from './store.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-29T12:00:00.000Z');

let dir: string;
let store: TurnChangeStore;
let objects: TurnChangeObjectStore;

function objectPath(sha: string): string {
  return join(dir, 'objects', sha.slice(0, 2), sha.slice(2));
}

async function age(sha: string, days: number): Promise<void> {
  const at = new Date(NOW - days * DAY);
  await utimes(objectPath(sha), at, at);
}

async function exists(sha: string): Promise<boolean> {
  return stat(objectPath(sha)).then(
    () => true,
    () => false,
  );
}

/** A sealed turn whose single run ended `daysAgo` days before NOW. */
async function turn(id: string, daysAgo: number): Promise<{ before: string; after: string }> {
  const before = (await objects.put(new TextEncoder().encode(`${id}-before`))).sha256;
  const after = (await objects.put(new TextEncoder().encode(`${id}-after`))).sha256;
  store.createAttempt({ changeSetId: id, attemptId: `at-${id}`, sessionId: 's', workspaceId: 'ws' });
  const endedAt = new Date(NOW - daysAgo * DAY).toISOString();
  store.beginRunSegment({ runId: `run-${id}`, attemptId: `at-${id}`, source: 'prompt', startedAt: endedAt });
  store.recordFileAction({
    actionId: `act-${id}`,
    runId: `run-${id}`,
    toolCallId: 'c1',
    actionOrdinal: 0,
    relativePath: 'a.txt',
    beforeSha: before,
    afterSha: after,
    beforeExists: true,
    afterExists: true,
    settlement: 'applied',
  });
  store.endRunSegment(`run-${id}`, endedAt);
  store.publishChangeVersion({
    changeSetId: id,
    revision: 1,
    files: [{ relativePath: 'a.txt', beforeSha: before, afterSha: after, beforeExists: true, afterExists: true }],
    coverageComplete: true,
    additions: 1,
    deletions: 1,
  });
  store.activateVersion(id, 1, 'ready');
  await age(before, daysAgo);
  await age(after, daysAgo);
  return { before, after };
}

describe('sweepTurnChangeRetention', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-retention-'));
    store = openTurnChangeStore({ rootDir: dir });
    objects = createTurnChangeObjectStore({ rootDir: dir });
    store.registerWorkspace({ workspaceId: 'ws', rootPath: '/w', hostInstanceId: 'h' });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('expires old turns, keeps their counts, and frees their bytes', async () => {
    const old = await turn('cs-old', 45);
    const recent = await turn('cs-recent', 3);

    const result = await sweepTurnChangeRetention({ store, rootDir: dir, now: () => NOW });

    expect(result).toMatchObject({ expiredChangeSets: 1, deletedObjects: 2 });
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(await exists(old.before)).toBe(false);
    expect(await exists(old.after)).toBe(false);
    expect(await exists(recent.before)).toBe(true);
    expect(await exists(recent.after)).toBe(true);
    expect(store.getAttempt('cs-old')?.captureState).toBe('expired');
    expect(store.getChangeVersion('cs-old', 1)).toMatchObject({ additions: 1, deletions: 1 });
    expect(store.getAttempt('cs-recent')?.captureState).toBe('ready');
  });

  it('keeps unreferenced bytes inside the grace period and deletes them after it', async () => {
    const fresh = (await store.putObject(new TextEncoder().encode('just put'))).sha256;
    const stale = (await store.putObject(new TextEncoder().encode('left behind'))).sha256;
    await age(fresh, 0.1);
    await age(stale, 2);

    const result = await sweepTurnChangeRetention({ store, rootDir: dir, now: () => NOW });

    expect(result.deletedObjects).toBe(1);
    expect(await exists(fresh)).toBe(true);
    expect(await exists(stale)).toBe(false);
  });

  it('never expires a turn with an undo still applying, nor frees what it needs', async () => {
    const old = await turn('cs-busy', 45);
    store.beginOperation({
      operationId: 'op-1',
      changeSetId: 'cs-busy',
      kind: 'undo',
      expectedRevision: 1,
      principal: 'host',
      idempotencyKey: 'k1',
      requestHash: 'h1',
    });
    store.recordOperationFiles([
      {
        operationId: 'op-1',
        relativePath: 'a.txt',
        fromSha: old.after,
        toSha: old.before,
        backupSha: old.after,
        fromExists: true,
        toExists: true,
        status: 'applied',
      },
    ]);

    const result = await sweepTurnChangeRetention({ store, rootDir: dir, now: () => NOW });

    expect(result.expiredChangeSets).toBe(0);
    expect(await exists(old.before)).toBe(true);
    expect(await exists(old.after)).toBe(true);
  });

  it('drops a finished undo backup when its turn expires, so its bytes are freed', async () => {
    const old = await turn('cs-undone', 45);
    const backup = (await objects.put(new TextEncoder().encode('backup-only bytes'))).sha256;
    store.beginOperation({
      operationId: 'op-done',
      changeSetId: 'cs-undone',
      kind: 'undo',
      expectedRevision: 1,
      principal: 'host',
      idempotencyKey: 'k-done',
      requestHash: 'h-done',
    });
    store.recordOperationFiles([
      {
        operationId: 'op-done',
        relativePath: 'a.txt',
        fromSha: old.after,
        toSha: old.before,
        backupSha: backup,
        fromExists: true,
        toExists: true,
        status: 'verified',
      },
    ]);
    store.updateOperationStatus('op-done', 'succeeded');
    await age(backup, 45);

    const result = await sweepTurnChangeRetention({ store, rootDir: dir, now: () => NOW });

    expect(result.expiredChangeSets).toBe(1);
    expect(await exists(backup)).toBe(false);
    expect(await exists(old.before)).toBe(false);
  });

  it('keeps a turn undone within the last week so 恢复改动 still works', async () => {
    await turn('cs-recent-undo', 45);
    store.beginOperation({
      operationId: 'op-recent',
      changeSetId: 'cs-recent-undo',
      kind: 'undo',
      expectedRevision: 1,
      principal: 'host',
      idempotencyKey: 'k-recent',
      requestHash: 'h-recent',
    });
    store.recordOperationStart({
      operationId: 'op-recent',
      workspaceId: 'ws',
      at: new Date(NOW - 2 * DAY).toISOString(),
    });
    store.updateOperationStatus('op-recent', 'succeeded');
    store.noteOperationUpdate('op-recent', null, new Date(NOW - 2 * DAY).toISOString());

    const result = await sweepTurnChangeRetention({ store, rootDir: dir, now: () => NOW });

    expect(result.expiredChangeSets).toBe(0);
    expect(store.getAttempt('cs-recent-undo')?.captureState).not.toBe('expired');
  });

  it('reusing an old unreferenced object refreshes it past the sweep', async () => {
    const sha = (await objects.put(new TextEncoder().encode('shared bytes'))).sha256;
    await age(sha, 10);
    await objects.put(new TextEncoder().encode('shared bytes'));

    await sweepTurnChangeRetention({ store, rootDir: dir, now: () => Date.now() });

    expect(await exists(sha)).toBe(true);
  });

  it('removes stale temp files only', async () => {
    await mkdir(join(dir, 'temp'), { recursive: true });
    await writeFile(join(dir, 'temp', 'old'), 'x');
    await writeFile(join(dir, 'temp', 'new'), 'y');
    const old = new Date(NOW - 2 * DAY);
    await utimes(join(dir, 'temp', 'old'), old, old);
    const recent = new Date(NOW - 60_000);
    await utimes(join(dir, 'temp', 'new'), recent, recent);

    const result = await sweepTurnChangeRetention({ store, rootDir: dir, now: () => NOW });

    expect(result.deletedTempFiles).toBe(1);
    expect(await readdir(join(dir, 'temp'))).toEqual(['new']);
  });
});

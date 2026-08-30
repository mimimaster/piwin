import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTurnChangeObjectStore } from './object-store.js';
import { recoverTurnChangeOperation } from './recovery.js';
import { openTurnChangeStore } from './store.js';

const temporaryDirectories: string[] = [];
const text = new TextEncoder();

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe('recoverTurnChangeOperation', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('rolls back an applied path and leaves an unwritten intent path untouched', async () => {
    const workspaceRoot = await createTempDir('piwin-turn-change-recovery-ws-');
    const storeRoot = await createTempDir('piwin-turn-change-recovery-store-');
    const store = openTurnChangeStore({ rootDir: storeRoot });
    const objectStore = createTurnChangeObjectStore({ rootDir: storeRoot });
    store.createAttempt({
      changeSetId: 'cs-1',
      attemptId: 'att-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });

    const beforeA = await objectStore.put(text.encode('a-before\n'));
    const afterA = await objectStore.put(text.encode('a-after\n'));
    const beforeB = await objectStore.put(text.encode('b-before\n'));
    const afterB = await objectStore.put(text.encode('b-after\n'));
    await writeFile(join(workspaceRoot, 'a.ts'), text.encode('a-after\n'));
    await writeFile(join(workspaceRoot, 'b.ts'), text.encode('b-before\n'));

    const begun = store.beginOperation({
      operationId: 'op-crash',
      changeSetId: 'cs-1',
      kind: 'undo',
      expectedRevision: 1,
      principal: 'user-1',
      idempotencyKey: 'undo-crash',
      requestHash: 'hash-crash',
    });
    expect(begun.outcome).toBe('created');
    store.recordOperationFiles([
      {
        operationId: 'op-crash',
        relativePath: 'a.ts',
        fromSha: beforeA.sha256,
        toSha: afterA.sha256,
        backupSha: beforeA.sha256,
        fromExists: true,
        toExists: true,
        status: 'applied',
      },
      {
        operationId: 'op-crash',
        relativePath: 'b.ts',
        fromSha: beforeB.sha256,
        toSha: afterB.sha256,
        backupSha: beforeB.sha256,
        fromExists: true,
        toExists: true,
        status: 'intent',
      },
    ]);

    const recovered = await recoverTurnChangeOperation({
      workspaceRoot,
      store,
      objectStore,
      operationId: 'op-crash',
    });

    expect(recovered.status).not.toBe('succeeded');
    expect(recovered.status).toBe('rolled-back');
    expect(await readFile(join(workspaceRoot, 'a.ts'), 'utf8')).toBe('a-before\n');
    expect(await readFile(join(workspaceRoot, 'b.ts'), 'utf8')).toBe('b-before\n');
    expect(store.getOperation('op-crash')?.status).toBe('rolled-back');
    expect(store.listOperationFiles('op-crash')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'a.ts', status: 'rolled-back' }),
        expect.objectContaining({ relativePath: 'b.ts', status: 'intent' }),
      ]),
    );
    expect(store.getAttempt('cs-1')?.disposition).toBe('applied');
    store.close();
  });
});

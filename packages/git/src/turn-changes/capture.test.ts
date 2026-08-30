import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { persistTurnChangeWriteReceipt } from './capture.js';
import { createTurnChangeObjectStore } from './object-store.js';
import { openTurnChangeStore } from './store.js';
import { writeTurnChangeFile } from './file-writer.js';

const temporaryDirectories: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe('persistTurnChangeWriteReceipt', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('persists one write receipt as a file_action with real CAS bytes', async () => {
    const workspaceRoot = await createTempDir('piwin-turn-change-capture-ws-');
    const storeRoot = await createTempDir('piwin-turn-change-capture-store-');
    const store = openTurnChangeStore({ rootDir: storeRoot });
    const objects = createTurnChangeObjectStore({ rootDir: storeRoot });
    await mkdir(join(workspaceRoot, 'src'));
    const bytes = new TextEncoder().encode('export {}\n');

    const receipt = await writeTurnChangeFile({
      workspaceRoot,
      relativePath: 'src/a.ts',
      bytes,
      store: objects,
    });

    persistTurnChangeWriteReceipt({
      store,
      actionId: 'action-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      actionOrdinal: 0,
      receipt,
      settlement: 'applied',
    });

    const actions = store.listFileActionsByRun('run-1');
    expect(actions).toEqual([
      {
        actionId: 'action-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        actionOrdinal: 0,
        relativePath: 'src/a.ts',
        beforeSha: null,
        afterSha: receipt.afterSha,
        beforeExists: false,
        afterExists: true,
        settlement: 'applied',
      },
    ]);
    if (receipt.afterSha === null) {
      throw new Error('expected afterSha');
    }
    expect(await store.getObject(receipt.afterSha)).toEqual(bytes);
    expect(await readFile(join(workspaceRoot, 'src/a.ts'))).toEqual(Buffer.from(bytes));
    store.close();
  });
});

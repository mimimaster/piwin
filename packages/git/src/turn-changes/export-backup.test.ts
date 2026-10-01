import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exportTurnChangeBackup } from './export-backup.js';
import { createTurnChangeObjectStore, type TurnChangeObjectStore } from './object-store.js';
import type { TurnChangeOperationFileRecord } from './operation-store.js';

let workspace: string;
let outside: string;
let objectStore: TurnChangeObjectStore;
let storeDir: string;
let files: TurnChangeOperationFileRecord[];

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'piwin-export-ws-'));
  outside = await mkdtemp(join(tmpdir(), 'piwin-export-out-'));
  storeDir = await mkdtemp(join(tmpdir(), 'piwin-export-store-'));
  objectStore = createTurnChangeObjectStore({ rootDir: storeDir });
  const a = await objectStore.put(new TextEncoder().encode('a before\n'));
  const b = await objectStore.put(new TextEncoder().encode('b before\n'));
  files = [
    { operationId: 'op-1', relativePath: 'src/a.ts', fromSha: a.sha256, toSha: null, backupSha: a.sha256, fromExists: true, toExists: true, status: 'applied' },
    { operationId: 'op-1', relativePath: 'b.txt', fromSha: b.sha256, toSha: null, backupSha: b.sha256, fromExists: true, toExists: false, status: 'applied' },
    { operationId: 'op-1', relativePath: 'new.md', fromSha: null, toSha: a.sha256, backupSha: null, fromExists: false, toExists: true, status: 'applied' },
  ];
});

afterEach(async () => {
  await Promise.all([workspace, outside, storeDir].map((dir) => rm(dir, { recursive: true, force: true })));
});

const run = (destination: string) =>
  exportTurnChangeBackup({ operationId: 'op-1', files, objectStore, workspaceRoot: workspace, destination });

describe('exportTurnChangeBackup', () => {
  it('writes the backups and a manifest into a new directory, never the workspace', async () => {
    const exported = await run(outside);
    expect(exported.destination).toBe(join(await import('node:fs/promises').then((fs) => fs.realpath(outside)), 'piwin-undo-backup-op-1'));
    expect(exported.exportedPaths.sort()).toEqual(['b.txt', 'src/a.ts']);
    expect(await readFile(join(exported.destination, 'src/a.ts'), 'utf8')).toBe('a before\n');
    expect(await readFile(join(exported.destination, 'b.txt'), 'utf8')).toBe('b before\n');
    const manifest = JSON.parse(await readFile(join(exported.destination, 'manifest.json'), 'utf8')) as {
      files: Array<{ relativePath: string; existed: boolean; sha256: string | null }>;
    };
    expect(manifest.files).toEqual([
      { relativePath: 'src/a.ts', existed: true, sha256: files[0]?.backupSha },
      { relativePath: 'b.txt', existed: true, sha256: files[1]?.backupSha },
      { relativePath: 'new.md', existed: false, sha256: null },
    ]);
    expect(await readdir(workspace)).toEqual([]);
  });

  it('refuses a destination inside the workspace, relative, missing, or already exported', async () => {
    await mkdir(join(workspace, 'backups'));
    await expect(run(join(workspace, 'backups'))).rejects.toMatchObject({ code: 'destination-inside-workspace' });
    await expect(run('relative/dir')).rejects.toMatchObject({ code: 'destination-not-absolute' });
    await expect(run(join(outside, 'nope'))).rejects.toMatchObject({ code: 'destination-missing' });
    await run(outside);
    await writeFile(join(outside, 'piwin-undo-backup-op-1', 'mine.txt'), 'keep');
    await expect(run(outside)).rejects.toMatchObject({ code: 'destination-exists' });
    expect(await readFile(join(outside, 'piwin-undo-backup-op-1', 'mine.txt'), 'utf8')).toBe('keep');
  });

  it('refuses without leaving a partial directory when a backup object is gone', async () => {
    const sha = files[1]?.backupSha ?? '';
    await rm(join(storeDir, 'objects', sha.slice(0, 2), sha.slice(2)));
    await expect(run(outside)).rejects.toMatchObject({ code: 'backup-missing' });
    expect(await readdir(outside)).toEqual([]);
    await expect(stat(join(outside, 'piwin-undo-backup-op-1'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

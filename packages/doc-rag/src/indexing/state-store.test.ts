import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openFolderStateStore } from './state-store.js';

describe('FolderStateStore', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('deletes a row and round-trips metadata JSON', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-state-'));
    const store = await openFolderStateStore(join(dir, 'state.sqlite3'));
    store.upsert({
      documentId: 'doc-1',
      folderKey: 'folder',
      relativePath: 'default/note.md',
      extension: '.md',
      fileSize: 12,
      fileHash: 'hash',
      configHash: 'cfg',
      status: 'READY',
      chunkCount: 2,
      indexedAt: '2026-09-01T00:00:00.000Z',
      metadata: { title: 'My note', tags: ['a', 'b'] },
    });
    expect(store.get('doc-1')?.metadata).toEqual({ title: 'My note', tags: ['a', 'b'] });
    store.upsert({
      documentId: 'doc-2',
      folderKey: 'folder',
      relativePath: 'plain.md',
      extension: '.md',
      fileSize: 4,
      fileHash: 'h2',
      configHash: 'cfg',
      status: 'READY',
      chunkCount: 1,
    });
    expect(store.get('doc-2')?.metadata).toBeUndefined();
    store.delete('doc-1');
    expect(store.get('doc-1')).toBeUndefined();
    expect(store.list().map((row) => row.documentId)).toEqual(['doc-2']);
    store.close();
  });

  it('adds the metadata column to a pre-existing database without a metadata column', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-state-'));
    const path = join(dir, 'state.sqlite3');
    // Simulate a database created before this round: the exact old schema,
    // with no `metadata` column at all (not even NULL-valued).
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE documents (
        document_id TEXT PRIMARY KEY,
        folder_key TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        extension TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_hash TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        last_error_message TEXT,
        indexed_at TEXT
      );
    `);
    legacy
      .prepare(
        `INSERT INTO documents(
          document_id, folder_key, relative_path, extension, file_size,
          file_hash, config_hash, status, chunk_count,
          last_error_code, last_error_message, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('old-doc', 'folder', 'old.md', '.md', 3, 'hash', 'cfg', 'READY', 1, null, null, null);
    legacy.close();

    const store = await openFolderStateStore(path);
    expect(store.get('old-doc')?.documentId).toBe('old-doc');
    expect(store.get('old-doc')?.metadata).toBeUndefined();
    store.upsert({
      documentId: 'old-doc',
      folderKey: 'folder',
      relativePath: 'old.md',
      extension: '.md',
      fileSize: 3,
      fileHash: 'hash',
      configHash: 'cfg',
      status: 'READY',
      chunkCount: 1,
      metadata: { title: 'Now tagged' },
    });
    expect(store.get('old-doc')?.metadata).toEqual({ title: 'Now tagged' });
    store.close();
  });
});

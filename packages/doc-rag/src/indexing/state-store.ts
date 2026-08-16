/**
 * Document + job state for a folder. The only new `node:sqlite` module in
 * doc-rag (legacy chunk cache remains in doc-index.ts until P7).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DocumentIndexStatus, DocumentManifest } from '@piwin/contracts';

export type DocumentStateRow = DocumentManifest & {
  configHash: string;
  chunkCount: number;
};

export type FolderStateStore = {
  get(documentId: string): DocumentStateRow | undefined;
  list(): DocumentStateRow[];
  upsert(row: DocumentStateRow): void;
  close(): void;
};

export async function openFolderStateStore(path: string): Promise<FolderStateStore> {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
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

  return {
    get(documentId) {
      const row = db
        .prepare('SELECT * FROM documents WHERE document_id = ?')
        .get(documentId) as Record<string, unknown> | undefined;
      return row ? fromRow(row) : undefined;
    },
    list() {
      const rows = db.prepare('SELECT * FROM documents').all() as Array<Record<string, unknown>>;
      return rows.map(fromRow);
    },
    upsert(row) {
      db.prepare(
        `INSERT OR REPLACE INTO documents(
          document_id, folder_key, relative_path, extension, file_size,
          file_hash, config_hash, status, chunk_count,
          last_error_code, last_error_message, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.documentId,
        row.folderKey,
        row.relativePath,
        row.extension,
        row.fileSize,
        row.fileHash,
        row.configHash,
        row.status,
        row.chunkCount,
        row.lastErrorCode ?? null,
        row.lastErrorMessage ?? null,
        row.indexedAt ?? null,
      );
    },
    close() {
      db.close();
    },
  };
}

function fromRow(row: Record<string, unknown>): DocumentStateRow {
  return {
    documentId: String(row.document_id),
    folderKey: String(row.folder_key),
    relativePath: String(row.relative_path),
    extension: String(row.extension),
    fileSize: Number(row.file_size),
    fileHash: String(row.file_hash),
    configHash: String(row.config_hash),
    status: row.status as DocumentIndexStatus,
    chunkCount: Number(row.chunk_count),
    ...(typeof row.last_error_code === 'string' ? { lastErrorCode: row.last_error_code } : {}),
    ...(typeof row.last_error_message === 'string'
      ? { lastErrorMessage: row.last_error_message }
      : {}),
    ...(typeof row.indexed_at === 'string' ? { indexedAt: row.indexed_at } : {}),
  };
}

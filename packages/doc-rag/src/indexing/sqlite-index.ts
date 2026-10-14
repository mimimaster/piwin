/**
 * Chunk index on `node:sqlite`: FTS5 for text, brute-force cosine for vectors,
 * RRF to fuse them. Replaces the LanceDB store (ADR 0018 appendix, 2026-10-13):
 * same `DocIndexStore` contract, no 220 MB native addon in the Host bundle.
 *
 * The index is a rebuildable cache; deleting the file loses zero user data.
 *
 * CJK: FTS5's `unicode61` tokenizer treats a run of Han characters as one
 * token, so content and queries are pre-segmented with `@piwin/notes`
 * `tokenize` (Intl.Segmenter) and stored space-joined.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cosineSimilarity, reciprocalRankFusion, tokenize, tokenizeForIndex } from '@piwin/notes';
import type {
  DocIndexStore,
  FtsQuery,
  HybridQuery,
  IndexedChunk,
  RetrievalHit,
} from './doc-index-store.js';

/** Each ranked list feeding RRF is this many times the requested limit. */
const FUSION_CANDIDATE_FACTOR = 3;
const DEFAULT_SEARCH_LIMIT = 10;

type ChunkRow = { id: number; chunk_json: string };
type RankedChunkRow = ChunkRow & { rank: number };
type VectorRow = { id: number; vector: Uint8Array };

function vectorToBlob(vector: number[]): Uint8Array {
  const floats = Float32Array.from(vector);
  return new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
}

function blobToVector(blob: Uint8Array): Float32Array {
  // Copy: sqlite blobs are not guaranteed to sit on a 4-byte boundary.
  return new Float32Array(blob.slice().buffer);
}

/**
 * OR of quoted tokens, ranked by BM25. Retrieval queries are whole questions;
 * requiring every token (FTS5's default AND) would return nothing for most of
 * them. Quoting keeps FTS5 operators in user input inert.
 */
export function buildRecallMatchExpression(query: string): string | null {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** `folder_key = ? [AND document_id IN (…)]` over the `chunks` table alias `c`. */
function scopeFilter(folderKey: string, documentIds?: string[]): { sql: string; params: string[] } {
  if (!documentIds || documentIds.length === 0) {
    return { sql: 'c.folder_key = ?', params: [folderKey] };
  }
  return {
    sql: `c.folder_key = ? AND c.document_id IN (${placeholders(documentIds.length)})`,
    params: [folderKey, ...documentIds],
  };
}

function chunkFromRow(row: ChunkRow): IndexedChunk {
  return JSON.parse(row.chunk_json) as IndexedChunk;
}

export async function openSqliteDocIndex(path: string): Promise<DocIndexStore> {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      chunk_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      folder_key TEXT NOT NULL,
      chunk_json TEXT NOT NULL,
      vector BLOB
    );
    CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS chunks_chunk_id ON chunks(chunk_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(tokens, tokenize = 'unicode61');
  `);

  /** chunks and chunk_fts share a rowid; always remove the pair together. */
  function deleteChunk(chunkId: string): void {
    db.prepare(
      'DELETE FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE chunk_id = ?)',
    ).run(chunkId);
    db.prepare('DELETE FROM chunks WHERE chunk_id = ?').run(chunkId);
  }

  function deleteDocument(documentId: string): void {
    db.prepare(
      'DELETE FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)',
    ).run(documentId);
    db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
  }

  function inTransaction(work: () => void): void {
    db.exec('BEGIN IMMEDIATE');
    try {
      work();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function rankedByText(query: FtsQuery, limit: number): RankedChunkRow[] {
    const match = buildRecallMatchExpression(query.text);
    if (!match) return [];
    const scope = scopeFilter(query.folderKey, query.documentIds);
    return db
      .prepare(
        `SELECT c.id AS id, c.chunk_json AS chunk_json, bm25(chunk_fts) AS rank
           FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
          WHERE chunk_fts MATCH ? AND ${scope.sql}
          ORDER BY rank LIMIT ?`,
      )
      .all(match, ...scope.params, limit) as RankedChunkRow[];
  }

  function rankedByVector(query: HybridQuery, vector: number[], limit: number): number[] {
    const target = Float32Array.from(vector);
    const scope = scopeFilter(query.folderKey, query.documentIds);
    const statement = db.prepare(
      `SELECT c.id AS id, c.vector AS vector FROM chunks c
        WHERE c.vector IS NOT NULL AND ${scope.sql}`,
    );
    const scored: Array<{ id: number; similarity: number }> = [];
    for (const row of statement.iterate(...scope.params) as Iterable<VectorRow>) {
      const candidate = blobToVector(row.vector);
      // A different dimension means the chunk was embedded by another model.
      if (candidate.length !== target.length) continue;
      const similarity = cosineSimilarity(target, candidate);
      // Orthogonal or opposed is not a match; ranking it would hand it RRF score.
      if (similarity > 0) scored.push({ id: row.id, similarity });
    }
    scored.sort((left, right) => right.similarity - left.similarity);
    return scored.slice(0, limit).map((entry) => entry.id);
  }

  function ftsSearch(query: FtsQuery): RetrievalHit[] {
    return rankedByText(query, query.limit ?? DEFAULT_SEARCH_LIMIT).map((row) => ({
      chunk: chunkFromRow(row),
      // bm25() is "more negative is better"; callers expect higher is better.
      score: -row.rank,
      retrievedBy: 'fts' as const,
    }));
  }

  return {
    async upsertChunks(chunks) {
      if (chunks.length === 0) return;
      const insertChunk = db.prepare(
        'INSERT INTO chunks(chunk_id, document_id, folder_key, chunk_json, vector) VALUES (?, ?, ?, ?, ?)',
      );
      const insertTokens = db.prepare('INSERT INTO chunk_fts(rowid, tokens) VALUES (?, ?)');
      inTransaction(() => {
        for (const documentId of new Set(chunks.map((chunk) => chunk.documentId))) {
          deleteDocument(documentId);
        }
        for (const chunk of chunks) {
          const { vector, ...stored } = chunk;
          deleteChunk(chunk.chunkId);
          const inserted = insertChunk.run(
            chunk.chunkId,
            chunk.documentId,
            chunk.folderKey,
            JSON.stringify(stored),
            vector && vector.length > 0 ? vectorToBlob(vector) : null,
          );
          insertTokens.run(inserted.lastInsertRowid, tokenizeForIndex(chunk.content));
        }
      });
    },

    async deleteByDocumentId(documentId) {
      inTransaction(() => deleteDocument(documentId));
    },

    async ftsSearch(query) {
      return ftsSearch(query);
    },

    async hybridSearch(query) {
      if (!query.vector || query.vector.length === 0) {
        return ftsSearch(query);
      }
      const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
      const candidates = limit * FUSION_CANDIDATE_FACTOR;
      const textIds = rankedByText(query, candidates).map((row) => String(row.id));
      const vectorIds = rankedByVector(query, query.vector, candidates).map(String);
      const fused = [...reciprocalRankFusion([textIds, vectorIds]).entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit);
      if (fused.length === 0) return [];
      const rows = db
        .prepare(
          `SELECT id, chunk_json FROM chunks WHERE id IN (${placeholders(fused.length)})`,
        )
        .all(...fused.map(([id]) => Number(id))) as ChunkRow[];
      const byId = new Map(rows.map((row) => [String(row.id), row]));
      const hits: RetrievalHit[] = [];
      for (const [id, score] of fused) {
        const row = byId.get(id);
        if (row) hits.push({ chunk: chunkFromRow(row), score, retrievedBy: 'hybrid' });
      }
      return hits;
    },

    async hasDocument(documentId) {
      return (
        db.prepare('SELECT 1 FROM chunks WHERE document_id = ? LIMIT 1').get(documentId) !==
        undefined
      );
    },

    async getChunksByIds(ids) {
      if (ids.length === 0) return [];
      const rows = db
        .prepare(
          `SELECT id, chunk_json FROM chunks WHERE chunk_id IN (${placeholders(ids.length)})`,
        )
        .all(...ids) as ChunkRow[];
      return rows.map(chunkFromRow);
    },

    async close() {
      db.close();
    },
  };
}

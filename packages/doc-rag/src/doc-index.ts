/**
 * sqlite FTS5 (+ optional vector) index over document chunks.
 *
 * Invariant (spec §6.1, §8.3): this is the ONLY module in `@piwin/doc-rag`
 * that may import `node:sqlite` (experimental API containment, same per-
 * package rule as notes/ADR 0018 §3). The index is a rebuildable cache;
 * deleting it loses zero user data.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DocChunk, EmbeddingProvider, RetrievedChunk } from '@piwin/contracts';
import { cosineSimilarity, tokenizeForIndex, buildMatchExpression } from '@piwin/notes';
import { DEFAULT_RETRIEVE_LIMIT, DEFAULT_MAX_TOTAL_CHARS } from './limits.js';
import { DEFAULT_RRF_K } from './rrf.js';

const EMBED_BATCH_SIZE = 16;

function float32ToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function bufferToFloat32(buffer: Uint8Array): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

export type DocIndex = {
  /** Replace all rows with these chunks (full rebuild per folder). */
  indexChunks: (chunks: DocChunk[]) => Promise<void>;
  /** Hybrid retrieve; degrades to FTS when no provider. */
  retrieve: (
    query: string,
    options?: {
      embeddingProvider?: EmbeddingProvider;
      limit?: number;
      fileAllowlist?: string[];
      maxTotalChars?: number;
      signal?: AbortSignal;
    },
  ) => Promise<RetrievedChunk[]>;
  /** Drop and rebuild (manual repair surface). */
  rebuild: () => Promise<void>;
  close: () => void;
};

export async function openDocIndex(indexPath: string): Promise<DocIndex> {
  await mkdir(dirname(indexPath), { recursive: true });
  const db = new DatabaseSync(indexPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_meta(
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      language TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
      id UNINDEXED, content
    );
    CREATE TABLE IF NOT EXISTS chunk_vec(
      id TEXT PRIMARY KEY,
      emb_model TEXT NOT NULL,
      emb_dim INTEGER NOT NULL,
      embedding BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunk_meta_file_path ON chunk_meta(file_path);
  `);

  function clearAll(): void {
    db.exec('DELETE FROM chunk_meta; DELETE FROM chunk_fts; DELETE FROM chunk_vec;');
  }

  function upsertChunk(chunk: DocChunk, id: string): void {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM chunk_fts WHERE id = ?').run(id);
      db.prepare('DELETE FROM chunk_vec WHERE id = ?').run(id);
      db.prepare(
        'INSERT OR REPLACE INTO chunk_meta(id, file_path, start_line, end_line, language, content) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, chunk.filePath, chunk.startLine, chunk.endLine, chunk.language, chunk.content);
      db.prepare('INSERT INTO chunk_fts(id, content) VALUES (?, ?)').run(
        id,
        tokenizeForIndex(chunk.content),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  async function indexChunks(chunks: DocChunk[]): Promise<void> {
    clearAll();
    for (const [position, chunk] of chunks.entries()) {
      const id = `chunk-${position.toString(36).padStart(6, '0')}`;
      upsertChunk(chunk, id);
    }
  }

  function searchFts(
    match: string,
    limit: number,
    fileAllowlist?: Set<string>,
  ): RetrievedChunk[] {
    const rows = db
      .prepare(
        `SELECT chunk_fts.id AS id, chunk_meta.content AS content,
                chunk_meta.file_path AS file_path,
                chunk_meta.start_line AS start_line,
                chunk_meta.end_line AS end_line,
                chunk_meta.language AS language,
                bm25(chunk_fts, 0.0, 1.0) AS score
         FROM chunk_fts JOIN chunk_meta ON chunk_meta.id = chunk_fts.id
         WHERE chunk_fts MATCH ?
         ORDER BY score LIMIT ?`,
      )
      .all(match, limit * 5) as Array<{
        id: string;
        content: string;
        file_path: string;
        start_line: number;
        end_line: number;
        language: string;
        score: number;
      }>;
    const hits: RetrievedChunk[] = [];
    for (const row of rows) {
      if (fileAllowlist && !fileAllowlist.has(row.file_path)) continue;
      hits.push({
        filePath: row.file_path,
        content: row.content,
        startLine: row.start_line,
        endLine: row.end_line,
        language: row.language,
        score: -row.score, // bm25 lower-is-better → invert
        snippet: makeSnippet(row.content, 160),
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  async function ensureVectors(provider: EmbeddingProvider, signal?: AbortSignal): Promise<void> {
    const missing = db
      .prepare(
        `SELECT chunk_meta.id AS id, chunk_meta.content AS content
         FROM chunk_meta
         LEFT JOIN chunk_vec ON chunk_vec.id = chunk_meta.id AND chunk_vec.emb_model = ?
         WHERE chunk_vec.id IS NULL`,
      )
      .all(provider.model) as Array<{ id: string; content: string }>;
    if (missing.length === 0) return;
    for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
      const batch = missing.slice(start, start + EMBED_BATCH_SIZE);
      const vectors = await provider.embed(
        batch.map((row) => row.content),
        signal,
      );
      if (vectors.length !== batch.length) {
        throw new Error('embedding provider returned wrong vector count');
      }
      for (const [position, row] of batch.entries()) {
        const vector = vectors[position];
        if (!vector) continue;
        db.prepare(
          'INSERT OR REPLACE INTO chunk_vec(id, emb_model, emb_dim, embedding) VALUES (?, ?, ?, ?)',
        ).run(row.id, provider.model, vector.length, float32ToBuffer(vector));
      }
    }
  }

  async function searchVector(
    query: string,
    provider: EmbeddingProvider,
    limit: number,
    fileAllowlist: Set<string> | undefined,
    signal?: AbortSignal,
  ): Promise<RetrievedChunk[]> {
    await ensureVectors(provider, signal);
    const queryVectors = await provider.embed([query], signal);
    const queryVector = queryVectors[0];
    if (!queryVector) return [];
    const rows = db
      .prepare(
        `SELECT chunk_vec.id AS id, chunk_vec.embedding AS embedding,
                chunk_meta.content AS content, chunk_meta.file_path AS file_path,
                chunk_meta.start_line AS start_line, chunk_meta.end_line AS end_line,
                chunk_meta.language AS language
         FROM chunk_vec JOIN chunk_meta ON chunk_meta.id = chunk_vec.id
         WHERE chunk_vec.emb_model = ?`,
      )
      .all(provider.model) as Array<{
      id: string;
      embedding: Uint8Array;
      content: string;
      file_path: string;
      start_line: number;
      end_line: number;
      language: string;
    }>;
    const scored: RetrievedChunk[] = [];
    for (const row of rows) {
      if (fileAllowlist && !fileAllowlist.has(row.file_path)) continue;
      const similarity = cosineSimilarity(queryVector, bufferToFloat32(row.embedding));
      scored.push({
        filePath: row.file_path,
        content: row.content,
        startLine: row.start_line,
        endLine: row.end_line,
        language: row.language,
        score: similarity,
        snippet: makeSnippet(row.content, 160),
      });
    }
    scored.sort((left, right) => right.score - left.score);
    return scored.slice(0, limit);
  }

  async function retrieve(
    query: string,
    options?: {
      embeddingProvider?: EmbeddingProvider;
      limit?: number;
      fileAllowlist?: string[];
      maxTotalChars?: number;
      signal?: AbortSignal;
    },
  ): Promise<RetrievedChunk[]> {
    const limit = options?.limit && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_RETRIEVE_LIMIT;
    const maxTotalChars = options?.maxTotalChars && options.maxTotalChars > 0
      ? options.maxTotalChars
      : DEFAULT_MAX_TOTAL_CHARS;
    const fileAllowlist = options?.fileAllowlist && options.fileAllowlist.length > 0
      ? new Set(options.fileAllowlist)
      : undefined;
    const match = buildMatchExpression(query);
    if (!match) return [];
    const ftsHits = searchFts(match, limit, fileAllowlist);
    const provider = options?.embeddingProvider;
    if (!provider) return truncateByChars(ftsHits, maxTotalChars);
    try {
      const vectorHits = await searchVector(query, provider, limit, fileAllowlist, options?.signal);
      const fused = fuseDocHits(ftsHits, vectorHits, limit);
      return truncateByChars(fused, maxTotalChars);
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      // Degrade to FTS on provider failure.
      return truncateByChars(ftsHits, maxTotalChars);
    }
  }

  async function rebuild(): Promise<void> {
    clearAll();
    // No-op without chunks; folder-rag re-indexes from source files.
  }

  return {
    indexChunks,
    retrieve,
    rebuild,
    close: () => db.close(),
  };
}

/** RRF fusion over doc chunks (self-contained — no NoteSearchHit coupling). */
function fuseDocHits(fts: RetrievedChunk[], vector: RetrievedChunk[], limit: number): RetrievedChunk[] {
  const byKey = new Map<string, RetrievedChunk>();
  const scores = new Map<string, number>();
  const addChannel = (hits: RetrievedChunk[], channel: 'fts' | 'vector'): void => {
    for (const [position, hit] of hits.entries()) {
      const key = `${hit.filePath}:${hit.startLine}`;
      const rank = position + 1;
      const contribution = 1 / (DEFAULT_RRF_K + rank);
      scores.set(key, (scores.get(key) ?? 0) + contribution);
      if (!byKey.has(key)) {
        byKey.set(key, hit);
      }
    }
  };
  addChannel(fts, 'fts');
  addChannel(vector, 'vector');
  return [...byKey.entries()]
    .map(([key, hit]) => ({ ...hit, score: scores.get(key) ?? 0 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

/** Truncate by total chars, preserving whole chunks. */
function truncateByChars(hits: RetrievedChunk[], maxTotalChars: number): RetrievedChunk[] {
  const result: RetrievedChunk[] = [];
  let total = 0;
  for (const hit of hits) {
    if (total + hit.content.length > maxTotalChars && result.length > 0) break;
    result.push(hit);
    total += hit.content.length;
  }
  return result;
}

function makeSnippet(content: string, maxLen: number): string {
  return content.length <= maxLen ? content : content.slice(0, maxLen);
}

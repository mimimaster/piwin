/**
 * FTS5 + vector index over the note store — the ONLY module in this package
 * that may import `node:sqlite` (experimental API containment, ADR 0018 §3).
 *
 * Invariant: this file is a rebuildable cache. Deleting the sqlite file must
 * lose zero user data; `reconcile()` recreates everything from markdown.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  EmbeddingProvider,
  NoteRecord,
  NoteSearchHit,
  NoteSearchQuery,
  RecallEvalReport,
} from '@piwin/contracts';
import type { NoteStore, ScannedNote } from './note-store.js';
import { getIndexPath } from './paths.js';
import { buildMatchExpression, tokenizeForIndex } from './tokenize.js';
import { bufferToFloat32, cosineSimilarity, float32ToBuffer } from './vector-math.js';

const EMBED_BATCH_SIZE = 16;

export type NoteIndex = {
  /** Lazy reconcile: sync index rows with the markdown source of truth. */
  reconcile: () => Promise<void>;
  /** FTS search over reconciled rows. */
  searchFts: (query: NoteSearchQuery) => NoteSearchHit[];
  /**
   * Vector search. Lazily embeds notes missing vectors for the provider's
   * model (batched); requires a provider. Throws on provider failure —
   * callers (searchNotes) degrade to FTS.
   */
  searchVector: (
    query: NoteSearchQuery,
    provider: EmbeddingProvider,
    signal?: AbortSignal,
  ) => Promise<NoteSearchHit[]>;
  /** Drop and rebuild all rows (manual repair surface). */
  rebuild: () => Promise<void>;
  /** Persist an eval report (cache; keeps the most recent runs only). */
  saveEvalRun: (report: RecallEvalReport) => void;
  /** Recent eval runs, newest first. */
  listEvalRuns: (limit?: number) => RecallEvalReport[];
  close: () => void;
};

const EVAL_RUN_KEEP = 20;

export async function openNoteIndex(store: NoteStore): Promise<NoteIndex> {
  const indexPath = getIndexPath(store.getNotesRoot());
  await mkdir(dirname(indexPath), { recursive: true });
  const db = new DatabaseSync(indexPath);
  // WAL + busy timeout: the index may be opened by desktop host, agent
  // sessions, and CLI concurrently; readers must not fail on a writer.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_meta(
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      mtime REAL NOT NULL,
      hash TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
      id UNINDEXED, title, body, tags
    );
    CREATE TABLE IF NOT EXISTS note_vec(
      id TEXT PRIMARY KEY,
      emb_model TEXT NOT NULL,
      emb_dim INTEGER NOT NULL,
      embedding BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eval_runs(
      run_at TEXT NOT NULL,
      report_json TEXT NOT NULL
    );
  `);

  /**
   * Transactional: a crash mid-upsert must never leave note_meta recording
   * the new hash while note_fts misses the row (reconcile would then skip
   * the note forever).
   */
  function upsert(entry: ScannedNote): void {
    const { record, mtimeMs } = entry;
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM note_fts WHERE id = ?').run(record.id);
      db.prepare(
        'INSERT OR REPLACE INTO note_meta(id, path, mtime, hash, record_json) VALUES (?, ?, ?, ?, ?)',
      ).run(record.id, record.relativePath, mtimeMs, record.contentHash, JSON.stringify(record));
      db.prepare('INSERT INTO note_fts(id, title, body, tags) VALUES (?, ?, ?, ?)').run(
        record.id,
        tokenizeForIndex(record.title),
        tokenizeForIndex(record.content),
        tokenizeForIndex((record.tags ?? []).join(' ')),
      );
      // Content changed → stored vector is stale; drop for lazy re-embed.
      db.prepare('DELETE FROM note_vec WHERE id = ?').run(record.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function removeIds(ids: string[]): void {
    for (const id of ids) {
      db.prepare('DELETE FROM note_meta WHERE id = ?').run(id);
      db.prepare('DELETE FROM note_fts WHERE id = ?').run(id);
      db.prepare('DELETE FROM note_vec WHERE id = ?').run(id);
    }
  }

  async function reconcile(): Promise<void> {
    const scanned = await store.scan();
    const indexed = new Map<string, { mtime: number; hash: string }>();
    const rows = db.prepare('SELECT id, mtime, hash FROM note_meta').all() as Array<{
      id: string;
      mtime: number;
      hash: string;
    }>;
    for (const row of rows) {
      indexed.set(row.id, { mtime: row.mtime, hash: row.hash });
    }

    const seen = new Set<string>();
    for (const entry of scanned) {
      seen.add(entry.record.id);
      const existing = indexed.get(entry.record.id);
      if (!existing || existing.hash !== entry.record.contentHash) {
        upsert(entry);
      }
    }
    const stale = [...indexed.keys()].filter((id) => !seen.has(id));
    removeIds(stale);
  }

  function passesFilters(note: NoteRecord, query: NoteSearchQuery): boolean {
    if (query.collection && note.collection !== query.collection) return false;
    if (query.tags && query.tags.length > 0) {
      const tags = note.tags ?? [];
      if (!query.tags.every((tag) => tags.includes(tag))) return false;
    }
    return true;
  }

  function searchFts(query: NoteSearchQuery): NoteSearchHit[] {
    const match = buildMatchExpression(query.query);
    if (!match) {
      return [];
    }
    const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 10;
    // Over-fetch so post-filters (collection/tags) do not starve results.
    const rows = db
      .prepare(
        // bm25 weights are positional over ALL columns: (id, title, body, tags).
        // id is UNINDEXED (weight ignored); title 5x, body 1x, tags 2x.
        `SELECT note_fts.id AS id, note_meta.record_json AS record_json,
                bm25(note_fts, 0.0, 5.0, 1.0, 2.0) AS score
         FROM note_fts JOIN note_meta ON note_meta.id = note_fts.id
         WHERE note_fts MATCH ?
         ORDER BY score LIMIT ?`,
      )
      .all(match, limit * 5) as Array<{ id: string; record_json: string; score: number }>;

    const hits: NoteSearchHit[] = [];
    let rank = 0;
    for (const row of rows) {
      const note = JSON.parse(row.record_json) as NoteRecord;
      if (!passesFilters(note, query)) continue;
      rank += 1;
      hits.push({
        note,
        // bm25() is lower-is-better (≤0); invert so higher is better.
        score: -row.score,
        snippet: makeSnippet(note, query.query),
        channels: ['fts'],
        rank: { fts: rank },
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** Embed notes lacking a current-model vector, in batches. */
  async function ensureVectors(
    provider: EmbeddingProvider,
    signal?: AbortSignal,
  ): Promise<void> {
    const missing = db
      .prepare(
        `SELECT note_meta.id AS id, note_meta.record_json AS record_json
         FROM note_meta
         LEFT JOIN note_vec ON note_vec.id = note_meta.id AND note_vec.emb_model = ?
         WHERE note_vec.id IS NULL`,
      )
      .all(provider.model) as Array<{ id: string; record_json: string }>;
    if (missing.length === 0) {
      return;
    }

    for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
      const batch = missing.slice(start, start + EMBED_BATCH_SIZE);
      const texts = batch.map((row) => {
        const note = JSON.parse(row.record_json) as NoteRecord;
        return `${note.title}\n\n${note.content}`;
      });
      const vectors = await provider.embed(texts, signal);
      if (vectors.length !== batch.length) {
        throw new Error('embedding provider returned wrong vector count');
      }
      for (const [position, row] of batch.entries()) {
        const vector = vectors[position];
        if (!vector) continue;
        db.prepare(
          'INSERT OR REPLACE INTO note_vec(id, emb_model, emb_dim, embedding) VALUES (?, ?, ?, ?)',
        ).run(row.id, provider.model, vector.length, float32ToBuffer(vector));
      }
    }
  }

  async function searchVector(
    query: NoteSearchQuery,
    provider: EmbeddingProvider,
    signal?: AbortSignal,
  ): Promise<NoteSearchHit[]> {
    const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 10;
    await ensureVectors(provider, signal);
    const queryVectors = await provider.embed([query.query], signal);
    const queryVector = queryVectors[0];
    if (!queryVector) {
      return [];
    }

    const rows = db
      .prepare(
        `SELECT note_vec.id AS id, note_vec.embedding AS embedding, note_meta.record_json AS record_json
         FROM note_vec JOIN note_meta ON note_meta.id = note_vec.id
         WHERE note_vec.emb_model = ?`,
      )
      .all(provider.model) as Array<{
      id: string;
      embedding: Uint8Array;
      record_json: string;
    }>;

    const scored: Array<{ note: NoteRecord; similarity: number }> = [];
    for (const row of rows) {
      const note = JSON.parse(row.record_json) as NoteRecord;
      if (!passesFilters(note, query)) continue;
      const similarity = cosineSimilarity(queryVector, bufferToFloat32(row.embedding));
      scored.push({ note, similarity });
    }
    scored.sort((left, right) => right.similarity - left.similarity);

    return scored.slice(0, limit).map((entry, position) => ({
      note: entry.note,
      score: entry.similarity,
      snippet: entry.note.content.slice(0, 160),
      channels: ['vector'] as Array<'fts' | 'vector'>,
      rank: { vector: position + 1 },
    }));
  }

  async function rebuild(): Promise<void> {
    db.exec('DELETE FROM note_meta; DELETE FROM note_fts; DELETE FROM note_vec;');
    await reconcile();
  }

  function saveEvalRun(report: RecallEvalReport): void {
    db.prepare('INSERT INTO eval_runs(run_at, report_json) VALUES (?, ?)').run(
      report.runAt,
      JSON.stringify(report),
    );
    db.prepare(
      `DELETE FROM eval_runs WHERE rowid NOT IN (
         SELECT rowid FROM eval_runs ORDER BY run_at DESC LIMIT ?
       )`,
    ).run(EVAL_RUN_KEEP);
  }

  function listEvalRuns(limit?: number): RecallEvalReport[] {
    const max = limit && limit > 0 ? Math.floor(limit) : EVAL_RUN_KEEP;
    const rows = db
      .prepare('SELECT report_json FROM eval_runs ORDER BY run_at DESC LIMIT ?')
      .all(max) as Array<{ report_json: string }>;
    return rows.map((row) => JSON.parse(row.report_json) as RecallEvalReport);
  }

  return {
    reconcile,
    searchFts,
    searchVector,
    rebuild,
    saveEvalRun,
    listEvalRuns,
    close: () => db.close(),
  };
}

/** Snippet from the raw (untokenized) content around the first query term. */
function makeSnippet(note: NoteRecord, query: string): string {
  const content = note.content;
  const probe = query.trim().split(/\s+/)[0] ?? '';
  const index = probe ? content.toLowerCase().indexOf(probe.toLowerCase()) : -1;
  if (index === -1) {
    return content.slice(0, 160);
  }
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + probe.length + 100);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

/**
 * FTS5 index over the note store — the ONLY module in this package that may
 * import `node:sqlite` (experimental API containment, ADR 0018 §3).
 *
 * Invariant: this file is a rebuildable cache. Deleting the sqlite file must
 * lose zero user data; `reconcile()` recreates everything from markdown.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NoteRecord, NoteSearchHit, NoteSearchQuery } from '@piwin/contracts';
import type { NoteStore, ScannedNote } from './note-store.js';
import { getIndexPath } from './paths.js';
import { buildMatchExpression, tokenizeForIndex } from './tokenize.js';

export type NoteIndex = {
  /** Lazy reconcile: sync index rows with the markdown source of truth. */
  reconcile: () => Promise<void>;
  /** FTS search; call `reconcile()` first (searchNotes below does both). */
  searchFts: (query: NoteSearchQuery) => NoteSearchHit[];
  /** Drop and rebuild all rows (manual repair surface). */
  rebuild: () => Promise<void>;
  close: () => void;
};

export async function openNoteIndex(store: NoteStore): Promise<NoteIndex> {
  const indexPath = getIndexPath(store.getNotesRoot());
  await mkdir(dirname(indexPath), { recursive: true });
  const db = new DatabaseSync(indexPath);
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
  `);

  function upsert(entry: ScannedNote): void {
    const { record, mtimeMs } = entry;
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
  }

  function removeIds(ids: string[]): void {
    for (const id of ids) {
      db.prepare('DELETE FROM note_meta WHERE id = ?').run(id);
      db.prepare('DELETE FROM note_fts WHERE id = ?').run(id);
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

  function searchFts(query: NoteSearchQuery): NoteSearchHit[] {
    const match = buildMatchExpression(query.query);
    if (!match) {
      return [];
    }
    const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 10;
    // Over-fetch so post-filters (collection/tags) do not starve results.
    const rows = db
      .prepare(
        `SELECT note_fts.id AS id, note_meta.record_json AS record_json,
                bm25(note_fts, 5.0, 1.0, 2.0) AS score
         FROM note_fts JOIN note_meta ON note_meta.id = note_fts.id
         WHERE note_fts MATCH ?
         ORDER BY score LIMIT ?`,
      )
      .all(match, limit * 5) as Array<{ id: string; record_json: string; score: number }>;

    const hits: NoteSearchHit[] = [];
    let rank = 0;
    for (const row of rows) {
      const note = JSON.parse(row.record_json) as NoteRecord;
      if (query.collection && note.collection !== query.collection) continue;
      if (query.tags && query.tags.length > 0) {
        const tags = note.tags ?? [];
        if (!query.tags.every((tag) => tags.includes(tag))) continue;
      }
      rank += 1;
      hits.push({
        note,
        // bm25() returns lower-is-better negative scores; invert for the contract.
        score: -row.score,
        snippet: makeSnippet(note, query.query),
        channels: ['fts'],
        rank: { fts: rank },
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  async function rebuild(): Promise<void> {
    db.exec('DELETE FROM note_meta; DELETE FROM note_fts;');
    await reconcile();
  }

  return {
    reconcile,
    searchFts,
    rebuild,
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

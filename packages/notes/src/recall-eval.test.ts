import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NoteRecord, NoteSearchHit } from '@piwin/contracts';
import {
  appendGoldenCase,
  loadGoldenSet,
  parseGoldenSet,
  runRecallEval,
} from './recall-eval.js';
import { createNoteStore } from './note-store.js';
import { openNoteIndex, type NoteIndex } from './note-index.js';

function makeHit(id: string): NoteSearchHit {
  const note: NoteRecord = {
    id,
    collection: 'default',
    title: id,
    content: `content ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    relativePath: `default/${id}.md`,
    contentHash: `hash-${id}`,
  };
  return { note, score: 1, snippet: '', channels: ['fts'], rank: {} };
}

describe('parseGoldenSet', () => {
  it('parses valid lines, skips comments/blanks, warns on malformed', () => {
    const raw = [
      '# my golden set',
      '',
      '{"query":"复习 调度","expectedNoteIds":["note-1"],"note":"srs case"}',
      '{"query":"missing ids","expectedNoteIds":[]}',
      'not json at all',
      '{"query":"two answers","expectedNoteIds":["a","b"]}',
    ].join('\n');
    const { cases, warnings } = parseGoldenSet(raw);
    expect(cases).toHaveLength(2);
    expect(cases[0]?.query).toBe('复习 调度');
    expect(cases[0]?.note).toBe('srs case');
    expect(cases[1]?.expectedNoteIds).toEqual(['a', 'b']);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('line 4');
    expect(warnings[1]).toContain('line 5');
  });
});

describe('runRecallEval', () => {
  const searchFixture =
    (ranking: Record<string, string[]>) =>
    async (query: string): Promise<NoteSearchHit[]> =>
      (ranking[query] ?? []).map(makeHit);

  it('computes exact recall@k and MRR', async () => {
    const report = await runRecallEval({
      cases: [
        { query: 'q1', expectedNoteIds: ['a'] }, // hit at rank 1
        { query: 'q2', expectedNoteIds: ['x'] }, // hit at rank 3
        { query: 'q3', expectedNoteIds: ['zz'] }, // miss
      ],
      mode: 'fts',
      k: 5,
      search: searchFixture({
        q1: ['a', 'b'],
        q2: ['m', 'n', 'x'],
        q3: ['p', 'q'],
      }),
    });
    // recall@5 = 2/3; MRR = (1/1 + 1/3 + 0) / 3
    expect(report.recallAtK).toBeCloseTo(2 / 3, 10);
    expect(report.mrr).toBeCloseTo((1 + 1 / 3) / 3, 10);
    expect(report.cases).toBe(3);
    expect(report.perCase[0]?.hitRank).toBe(1);
    expect(report.perCase[1]?.hitRank).toBe(3);
    expect(report.perCase[2]?.hitRank).toBeNull();
  });

  it('any expected id counts as a hit', async () => {
    const report = await runRecallEval({
      cases: [{ query: 'q', expectedNoteIds: ['a', 'b'] }],
      mode: 'hybrid',
      search: searchFixture({ q: ['c', 'b'] }),
    });
    expect(report.recallAtK).toBe(1);
    expect(report.perCase[0]?.hitRank).toBe(2);
  });

  it('handles empty case list', async () => {
    const report = await runRecallEval({
      cases: [],
      mode: 'fts',
      search: searchFixture({}),
    });
    expect(report.recallAtK).toBe(0);
    expect(report.mrr).toBe(0);
    expect(report.cases).toBe(0);
  });
});

describe('golden set file + eval run history', () => {
  let piwinRoot: string;
  let index: NoteIndex;

  beforeEach(async () => {
    piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-eval-'));
  });

  afterEach(async () => {
    await rm(piwinRoot, { recursive: true, force: true });
  });

  it('appendGoldenCase + loadGoldenSet round-trips', async () => {
    const store = createNoteStore({ piwinRoot });
    const notesRoot = store.getNotesRoot();
    expect((await loadGoldenSet(notesRoot)).cases).toEqual([]);
    await appendGoldenCase(notesRoot, { query: '复习', expectedNoteIds: ['n1'] });
    await appendGoldenCase(notesRoot, { query: 'fsrs', expectedNoteIds: ['n2'], note: 'x' });
    const { cases, warnings } = await loadGoldenSet(notesRoot);
    expect(cases).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('saveEvalRun keeps history capped and ordered', async () => {
    const store = createNoteStore({ piwinRoot });
    index = await openNoteIndex(store);
    try {
      for (let run = 0; run < 25; run += 1) {
        index.saveEvalRun({
          runAt: new Date(Date.UTC(2026, 0, 1, 0, run)).toISOString(),
          mode: 'fts',
          k: 5,
          cases: 1,
          recallAtK: run / 25,
          mrr: run / 25,
          perCase: [],
        });
      }
      const runs = index.listEvalRuns();
      expect(runs).toHaveLength(20);
      const first = runs[0];
      if (!first) throw new Error('expected runs');
      // Newest first (run 24)
      expect(first.recallAtK).toBeCloseTo(24 / 25, 10);
    } finally {
      index.close();
    }
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendGoldenCase, loadGoldenSet, parseGoldenSet } from './golden-set.js';
import { createNoteStore } from './note-store.js';

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

describe('golden set file', () => {
  let piwinRoot: string;

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
});

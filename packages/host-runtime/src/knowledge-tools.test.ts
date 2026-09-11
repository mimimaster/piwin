import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatCitationLocation,
  formatKnowledgeCitationsText,
  KnowledgePathEscapeError,
  readConfinedLineWindow,
  resetKnowledgeRefCounters,
} from './knowledge-tools.js';
import type { KnowledgeCitation } from '@piwin/contracts';

const cleanup: string[] = [];

afterEach(async () => {
  resetKnowledgeRefCounters();
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const citation = (overrides: Partial<KnowledgeCitation> = {}): KnowledgeCitation => ({
  ref: 1,
  baseId: 'notes',
  baseName: 'Notes',
  kind: 'notes',
  title: 'FSRS',
  noteId: 'n1',
  text: 'Spaced repetition schedules reviews.',
  ...overrides,
});

describe('formatKnowledgeCitationsText', () => {
  it('matches the numbered block golden format', () => {
    const text = formatKnowledgeCitationsText([
      citation(),
      citation({
        ref: 2,
        baseId: 'folder:0123456789abcdef',
        baseName: 'Docs',
        kind: 'folder',
        title: 'guide/intro.md',
        relativePath: 'guide/intro.md',
        startLine: 12,
        endLine: 20,
        text: 'Review intervals grow after a successful recall.',
      }),
    ]);
    expect(text).toBe(
      [
        '[1] Notes · FSRS',
        'Spaced repetition schedules reviews.',
        '',
        '[2] Docs · guide/intro.md:12-20',
        'Review intervals grow after a successful recall.',
      ].join('\n'),
    );
  });

  it('states that nothing relevant was found', () => {
    expect(formatKnowledgeCitationsText([])).toBe(
      'No relevant passages were found in the knowledge base.',
    );
  });
});

describe('formatCitationLocation', () => {
  it('uses page ranges when lines are absent', () => {
    expect(
      formatCitationLocation(
        citation({
          kind: 'folder',
          title: 'paper.pdf',
          relativePath: 'paper.pdf',
          pageStart: 3,
          pageEnd: 5,
        }),
      ),
    ).toBe('paper.pdf:p.3-5');
  });
});

describe('knowledge_read confinement', () => {
  it('allows a relative path inside the folder and blocks escapes', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'piwin-kb-read-'));
    cleanup.push(folder);
    await mkdir(join(folder, 'docs'), { recursive: true });
    await writeFile(join(folder, 'docs', 'a.md'), ['one', 'two', 'three', 'four'].join('\n'));

    const allowed = await readConfinedLineWindow(folder, 'docs/a.md', 2, 3);
    expect(allowed).toEqual({ text: 'two\nthree', startLine: 2, endLine: 3 });

    await expect(readConfinedLineWindow(folder, '../etc/passwd')).rejects.toBeInstanceOf(
      KnowledgePathEscapeError,
    );
    await expect(readConfinedLineWindow(folder, '/etc/passwd')).rejects.toBeInstanceOf(
      KnowledgePathEscapeError,
    );
    await expect(readConfinedLineWindow(folder, 'docs/../../etc/passwd')).rejects.toBeInstanceOf(
      KnowledgePathEscapeError,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { findSystemFileReferences, splitSystemFileReferences } from './system-file-references';

describe('findSystemFileReferences', () => {
  it('finds source paths and bare file names', () => {
    const references = findSystemFileReferences('Updated src/app.ts and README.md.');
    expect(references.map((reference) => reference.label)).toEqual(['src/app.ts', 'README.md']);
  });

  it('does not turn URLs or domain names into workspace files', () => {
    const references = findSystemFileReferences(
      'See https://example.com/app.ts and mail@example.com.',
    );
    expect(references).toEqual([]);
  });

  it('resolves an unambiguous basename to a known tool path', () => {
    const references = findSystemFileReferences('Edited widget.ts.', ['src/widget.ts']);
    expect(references).toEqual([
      {
        start: 7,
        end: 16,
        path: 'src/widget.ts',
        label: 'widget.ts',
      },
    ]);
  });

  it('supports known files with spaces in their names', () => {
    const references = findSystemFileReferences('Created `release notes.md`.', [
      'docs/release notes.md',
    ]);
    expect(references).toEqual([
      {
        start: 9,
        end: 25,
        path: 'docs/release notes.md',
        label: 'release notes.md',
      },
    ]);
  });
});

describe('splitSystemFileReferences', () => {
  it('preserves surrounding text and newlines', () => {
    const parts = splitSystemFileReferences('Modified src/a.ts\nAdded src/b.ts');
    expect(parts).toEqual([
      { kind: 'text', text: 'Modified ' },
      {
        kind: 'file',
        reference: { start: 9, end: 17, path: 'src/a.ts', label: 'src/a.ts' },
      },
      { kind: 'text', text: '\nAdded ' },
      {
        kind: 'file',
        reference: { start: 24, end: 32, path: 'src/b.ts', label: 'src/b.ts' },
      },
    ]);
  });
});

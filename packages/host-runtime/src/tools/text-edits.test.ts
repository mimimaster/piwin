import { describe, expect, it } from 'vitest';

import {
  applyTextEditsToFileText,
  applyTextEditsToNormalized,
  normalizeEditArguments,
  TextEditError,
} from './text-edits.js';

describe('applyTextEditsToNormalized', () => {
  const file = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';

  it('applies disjoint edits matched against the original text', () => {
    expect(
      applyTextEditsToNormalized(
        file,
        [
          { oldText: 'const c = 3;', newText: 'const c = 30;' },
          { oldText: 'const a = 1;', newText: 'const a = 10;' },
        ],
        'f.ts',
      ),
    ).toBe('const a = 10;\nconst b = 2;\nconst c = 30;\n');
  });

  it.each([
    [[{ oldText: 'missing', newText: 'x' }], 'Could not find the exact text'],
    [[{ oldText: 'const', newText: 'let' }], 'Found 3 occurrences of the text'],
    [[{ oldText: '', newText: 'x' }], 'oldText must not be empty'],
    [[{ oldText: 'const a = 1;', newText: 'const a = 1;' }], 'No changes made'],
    [
      [
        { oldText: 'const a = 1;\nconst b', newText: 'x' },
        { oldText: 'const b = 2;', newText: 'y' },
      ],
      'overlap',
    ],
  ])('rejects %j', (edits, message) => {
    expect(() => applyTextEditsToNormalized(file, edits, 'f.ts')).toThrow(TextEditError);
    expect(() => applyTextEditsToNormalized(file, edits, 'f.ts')).toThrow(message);
  });

  it('does not fuzzy-match: smart quotes and trailing spaces must be exact', () => {
    expect(() =>
      applyTextEditsToNormalized('say(“hi”)\n', [{ oldText: 'say("hi")', newText: 'x' }], 'f.ts'),
    ).toThrow('Could not find');
  });
});

describe('applyTextEditsToFileText', () => {
  it('keeps CRLF line endings and the BOM', () => {
    const raw = '﻿one\r\ntwo\r\nthree\r\n';
    expect(
      applyTextEditsToFileText(raw, [{ oldText: 'one\ntwo', newText: 'one\nTWO' }], 'f.txt'),
    ).toBe('﻿one\r\nTWO\r\nthree\r\n');
  });
});

describe('normalizeEditArguments', () => {
  it('accepts edits sent as a JSON string and the legacy oldText/newText pair', () => {
    expect(
      normalizeEditArguments({ path: 'a.ts', edits: '[{"oldText":"x","newText":"y"}]' }),
    ).toEqual({ ok: true, path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }] });
    expect(normalizeEditArguments({ path: 'a.ts', oldText: 'x', newText: 'y' })).toEqual({
      ok: true,
      path: 'a.ts',
      edits: [{ oldText: 'x', newText: 'y' }],
    });
  });

  it('rejects a missing path or an empty edit list', () => {
    expect(normalizeEditArguments({ edits: [] })).toMatchObject({ ok: false });
    expect(normalizeEditArguments({ path: 'a.ts', edits: [] })).toMatchObject({ ok: false });
    expect(normalizeEditArguments({ path: 'a.ts', edits: [{ oldText: 1 }] })).toMatchObject({
      ok: false,
    });
  });
});

import { describe, expect, it } from 'vitest';

import { composeFileActions, type ComposedFileAction } from './compose.js';

function file(
  relativePath: string,
  beforeSha: string | null,
  afterSha: string | null,
  beforeExists: boolean,
  afterExists: boolean,
): ComposedFileAction {
  return { relativePath, beforeSha, afterSha, beforeExists, afterExists };
}

describe('composeFileActions', () => {
  it('returns complete coverage and no files for an empty list', () => {
    expect(composeFileActions([])).toEqual({ coverage: 'complete', files: [] });
  });

  it('keeps a single-path modify as the net file', () => {
    expect(composeFileActions([file('src/a.ts', 'sha-a', 'sha-b', true, true)])).toEqual({
      coverage: 'complete',
      files: [file('src/a.ts', 'sha-a', 'sha-b', true, true)],
    });
  });

  it('nets create then delete to no files', () => {
    expect(
      composeFileActions([
        file('src/a.ts', null, 'sha-a', false, true),
        file('src/a.ts', 'sha-a', null, true, false),
      ]),
    ).toEqual({ coverage: 'complete', files: [] });
  });

  it('nets delete then create to one modify', () => {
    expect(
      composeFileActions([
        file('src/a.ts', 'sha-old', null, true, false),
        file('src/a.ts', null, 'sha-new', false, true),
      ]),
    ).toEqual({
      coverage: 'complete',
      files: [file('src/a.ts', 'sha-old', 'sha-new', true, true)],
    });
  });

  it('nets create then modify as a create', () => {
    expect(
      composeFileActions([
        file('src/a.ts', null, 'sha-a', false, true),
        file('src/a.ts', 'sha-a', 'sha-b', true, true),
      ]),
    ).toEqual({
      coverage: 'complete',
      files: [file('src/a.ts', null, 'sha-b', false, true)],
    });
  });

  it('nets modify then delete as a delete', () => {
    expect(
      composeFileActions([
        file('src/a.ts', 'sha-a', 'sha-b', true, true),
        file('src/a.ts', 'sha-b', null, true, false),
      ]),
    ).toEqual({
      coverage: 'complete',
      files: [file('src/a.ts', 'sha-a', null, true, false)],
    });
  });

  it('drops a path when before equals after and exists is unchanged', () => {
    expect(
      composeFileActions([
        file('src/a.ts', 'sha-a', 'sha-b', true, true),
        file('src/a.ts', 'sha-b', 'sha-a', true, true),
      ]),
    ).toEqual({ coverage: 'complete', files: [] });
  });

  it('marks a broken chain incomplete and omits that path', () => {
    expect(
      composeFileActions([
        file('src/a.ts', 'sha-a', 'sha-b', true, true),
        file('src/a.ts', 'sha-other', 'sha-c', true, true),
      ]),
    ).toEqual({ coverage: 'incomplete', files: [] });
  });

  it('treats an exists mismatch as a broken chain', () => {
    expect(
      composeFileActions([
        file('src/a.ts', 'sha-a', 'sha-b', true, true),
        file('src/a.ts', 'sha-b', 'sha-c', false, true),
      ]),
    ).toEqual({ coverage: 'incomplete', files: [] });
  });

  it('keeps complete paths when another path is incomplete', () => {
    expect(
      composeFileActions([
        file('src/ok.ts', 'sha-a', 'sha-b', true, true),
        file('src/bad.ts', 'sha-a', 'sha-b', true, true),
        file('src/bad.ts', 'sha-other', 'sha-c', true, true),
        file('src/ok.ts', 'sha-b', 'sha-c', true, true),
      ]),
    ).toEqual({
      coverage: 'incomplete',
      files: [file('src/ok.ts', 'sha-a', 'sha-c', true, true)],
    });
  });

  it('preserves first-seen path order for net files', () => {
    expect(
      composeFileActions([
        file('b.ts', 'sha-b1', 'sha-b2', true, true),
        file('a.ts', null, 'sha-a', false, true),
        file('b.ts', 'sha-b2', 'sha-b3', true, true),
      ]),
    ).toEqual({
      coverage: 'complete',
      files: [file('b.ts', 'sha-b1', 'sha-b3', true, true), file('a.ts', null, 'sha-a', false, true)],
    });
  });

  it('does not drop a path when sha matches but exists changed', () => {
    expect(composeFileActions([file('src/a.ts', 'sha-a', 'sha-a', true, false)])).toEqual({
      coverage: 'complete',
      files: [file('src/a.ts', 'sha-a', 'sha-a', true, false)],
    });
  });
});

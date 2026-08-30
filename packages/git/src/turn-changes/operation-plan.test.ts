import { describe, expect, it } from 'vitest';

import { composeFileActions } from './compose.js';
import { planUndoRedo, type PlannedFileOp } from './operation-plan.js';

function file(
  relativePath: string,
  beforeSha: string | null,
  afterSha: string | null,
  beforeExists: boolean,
  afterExists: boolean,
) {
  return { relativePath, beforeSha, afterSha, beforeExists, afterExists };
}

describe('planUndoRedo', () => {
  it('maps undo after→before and redo before→after', () => {
    const files = [file('src/a.ts', 'sha-before', 'sha-after', true, true)];

    expect(planUndoRedo({ files, direction: 'undo' })).toEqual<PlannedFileOp[]>([
      {
        relativePath: 'src/a.ts',
        fromSha: 'sha-after',
        toSha: 'sha-before',
        fromExists: true,
        toExists: true,
      },
    ]);
    expect(planUndoRedo({ files, direction: 'redo' })).toEqual<PlannedFileOp[]>([
      {
        relativePath: 'src/a.ts',
        fromSha: 'sha-before',
        toSha: 'sha-after',
        fromExists: true,
        toExists: true,
      },
    ]);
  });

  it('returns an empty plan for empty net files', () => {
    expect(planUndoRedo({ files: [], direction: 'undo' })).toEqual([]);
    expect(planUndoRedo({ files: [], direction: 'redo' })).toEqual([]);
  });

  it('maps create undo to a delete and delete undo to a restore', () => {
    expect(
      planUndoRedo({
        files: [file('src/new.ts', null, 'sha-new', false, true)],
        direction: 'undo',
      }),
    ).toEqual([
      {
        relativePath: 'src/new.ts',
        fromSha: 'sha-new',
        toSha: null,
        fromExists: true,
        toExists: false,
      },
    ]);
    expect(
      planUndoRedo({
        files: [file('src/gone.ts', 'sha-old', null, true, false)],
        direction: 'undo',
      }),
    ).toEqual([
      {
        relativePath: 'src/gone.ts',
        fromSha: null,
        toSha: 'sha-old',
        fromExists: false,
        toExists: true,
      },
    ]);
  });

  it('preserves composed net-file order', () => {
    const composed = composeFileActions([
      file('b.ts', 'b0', 'b1', true, true),
      file('a.ts', null, 'a1', false, true),
      file('b.ts', 'b1', 'b2', true, true),
    ]);
    expect(composed.files.map((entry) => entry.relativePath)).toEqual(['b.ts', 'a.ts']);
    expect(planUndoRedo({ files: composed.files, direction: 'undo' })).toEqual([
      {
        relativePath: 'b.ts',
        fromSha: 'b2',
        toSha: 'b0',
        fromExists: true,
        toExists: true,
      },
      {
        relativePath: 'a.ts',
        fromSha: 'a1',
        toSha: null,
        fromExists: true,
        toExists: false,
      },
    ]);
  });
});

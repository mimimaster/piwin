/**
 * Map a composed before/after file list onto undo or redo path restores.
 */

export type PlannedFileOp = {
  relativePath: string;
  fromSha: string | null;
  toSha: string | null;
  fromExists: boolean;
  toExists: boolean;
};

export function planUndoRedo(input: {
  files: readonly {
    relativePath: string;
    beforeSha: string | null;
    afterSha: string | null;
    beforeExists: boolean;
    afterExists: boolean;
  }[];
  direction: 'undo' | 'redo';
}): PlannedFileOp[] {
  return input.files.map((file) =>
    input.direction === 'undo'
      ? {
          relativePath: file.relativePath,
          fromSha: file.afterSha,
          toSha: file.beforeSha,
          fromExists: file.afterExists,
          toExists: file.beforeExists,
        }
      : {
          relativePath: file.relativePath,
          fromSha: file.beforeSha,
          toSha: file.afterSha,
          fromExists: file.beforeExists,
          toExists: file.afterExists,
        },
  );
}

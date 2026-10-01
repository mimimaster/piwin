/**
 * Map a composed before/after file list onto undo or redo path restores.
 */

export type PlannedFileOp = {
  relativePath: string;
  fromSha: string | null;
  toSha: string | null;
  fromExists: boolean;
  toExists: boolean;
  /**
   * The file may be left alone when it no longer matches `fromSha` (undo of a
   * file only commands created), instead of refusing the whole operation.
   */
  skippable?: boolean;
};

export function planUndoRedo(input: {
  files: readonly {
    relativePath: string;
    beforeSha: string | null;
    afterSha: string | null;
    beforeExists: boolean;
    afterExists: boolean;
    /** Only shell commands touched this path. */
    commandOnly?: boolean;
  }[];
  direction: 'undo' | 'redo';
  /** Redo: paths the undo being redone left in place; they were never reverted. */
  leftInPlace?: readonly string[];
}): PlannedFileOp[] {
  if (input.direction === 'redo') {
    const left = new Set(input.leftInPlace ?? []);
    return input.files
      .filter((file) => !left.has(file.relativePath))
      .map((file) => ({
        relativePath: file.relativePath,
        fromSha: file.beforeSha,
        toSha: file.afterSha,
        fromExists: file.beforeExists,
        toExists: file.afterExists,
      }));
  }
  return input.files.map((file) => ({
    relativePath: file.relativePath,
    fromSha: file.afterSha,
    toSha: file.beforeSha,
    fromExists: file.afterExists,
    toExists: file.beforeExists,
    // A file a command created and nothing else wrote: if it changed since (a
    // dev server, a log), undo keeps it rather than refusing the whole turn.
    ...(file.commandOnly === true && !file.beforeExists ? { skippable: true } : {}),
  }));
}

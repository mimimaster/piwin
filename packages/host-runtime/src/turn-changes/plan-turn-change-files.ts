/**
 * The file operations one undo or redo of a sealed version would perform.
 * Shared by the command that runs it and `turn-changes/check`, so
 * 重新检查 plans exactly what undo would.
 */
import { planUndoRedo, type PlannedFileOp, type TurnChangeStore } from '@piwin/git';

type SealedVersion = NonNullable<ReturnType<TurnChangeStore['getChangeVersion']>>;

/**
 * Undo may leave a file alone that only commands created and that changed
 * since (planUndoRedo marks it `skippable`). Redo must then leave the same
 * files alone: the undo never reverted them, so there is nothing to re-apply.
 */
export function planTurnChangeFiles(
  store: TurnChangeStore,
  input: { changeSetId: string; version: SealedVersion; direction: 'undo' | 'redo' },
): PlannedFileOp[] {
  const latest = store.getLatestChangeSetOperation(input.changeSetId);
  const leftInPlace =
    input.direction === 'redo' && latest?.kind === 'undo' && latest.status === 'succeeded'
      ? (store.getOperationNote(latest.operationId)?.skippedPaths ?? [])
      : [];
  return planUndoRedo({
    direction: input.direction,
    leftInPlace,
    files: input.version.files.map((file) => ({
      relativePath: file.relativePath,
      beforeSha: file.beforeSha,
      afterSha: file.afterSha,
      beforeExists: file.beforeSha !== null,
      afterExists: file.afterSha !== null,
      commandOnly: file.commandOnly,
    })),
  });
}

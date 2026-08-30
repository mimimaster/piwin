/**
 * Persist one writer receipt as a file_action row.
 */
import type { TurnChangeWriteReceipt } from './file-writer.js';
import type { TurnChangeFileActionRecord, TurnChangeStore } from './store.js';

export function persistTurnChangeWriteReceipt(input: {
  store: Pick<TurnChangeStore, 'recordFileAction'>;
  actionId: string;
  runId: string;
  toolCallId: string | null;
  actionOrdinal: number;
  receipt: TurnChangeWriteReceipt;
  settlement: string;
}): void {
  const record: TurnChangeFileActionRecord = {
    actionId: input.actionId,
    runId: input.runId,
    toolCallId: input.toolCallId,
    actionOrdinal: input.actionOrdinal,
    relativePath: input.receipt.relativePath,
    beforeSha: input.receipt.beforeSha,
    afterSha: input.receipt.afterSha,
    beforeExists: input.receipt.beforeExists,
    afterExists: input.receipt.afterExists,
    settlement: input.settlement,
  };
  input.store.recordFileAction(record);
}

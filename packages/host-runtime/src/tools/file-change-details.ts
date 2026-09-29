/**
 * Turn a Host file write's turn-change receipt into this call's own change.
 *
 * The receipt already holds the before/after object hashes, so the diff is
 * exact for the call — unlike a working-tree diff against HEAD, which also
 * shows other sessions' and earlier turns' edits to the same file.
 */
import type { ToolFileChange, ToolResult } from '@piwin/contracts';
import {
  diffTurnChangeObjects,
  type TurnChangeObjectStore,
  type TurnChangeWriteReceipt,
} from '@piwin/git';

/** Keep transcripts bounded; larger changes show counts only. */
export const MAX_TOOL_FILE_CHANGE_PATCH_CHARS = 64_000;

export async function describeFileChange(
  receipt: TurnChangeWriteReceipt,
  store: TurnChangeObjectStore,
): Promise<ToolFileChange | undefined> {
  const status: ToolFileChange['status'] = !receipt.beforeExists
    ? 'added'
    : receipt.afterExists
      ? 'modified'
      : 'deleted';
  try {
    const diff = await diffTurnChangeObjects({
      store,
      beforeSha: receipt.beforeSha,
      afterSha: receipt.afterSha,
      pathLabel: receipt.relativePath,
    });
    return {
      path: receipt.relativePath,
      status,
      additions: diff.additions,
      deletions: diff.deletions,
      binary: diff.binary,
      ...(diff.patch !== undefined && diff.patch.length <= MAX_TOOL_FILE_CHANGE_PATCH_CHARS
        ? { patch: diff.patch }
        : {}),
    };
  } catch (error) {
    // Display enrichment only: the write itself succeeded and is recorded.
    console.warn(`[host-runtime] could not diff ${receipt.relativePath} for its tool card`, error);
    return undefined;
  }
}

export function withFileChange(result: ToolResult, fileChange: ToolFileChange | undefined): ToolResult {
  return fileChange === undefined ? result : { ...result, details: { ...result.details, fileChange } };
}

/** Whether a failed/truncated attempt still has work worth keeping on Continue. */

export function turnAttemptHasRetainedWork(input: {
  text: string;
  tools: readonly unknown[];
  attachments: readonly unknown[];
  turnTools?: readonly unknown[] | undefined;
}): boolean {
  if (input.text.trim().length > 0) {
    return true;
  }
  if (input.attachments.length > 0) {
    return true;
  }
  if (input.tools.length > 0) {
    return true;
  }
  return (input.turnTools?.length ?? 0) > 0;
}

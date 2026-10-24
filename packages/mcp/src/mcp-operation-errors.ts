/** Classifies failures from MCP operations; the message text is the only signal the SDK gives. */

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('aborted');
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('timeout');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('MCP operation aborted');
  }
}

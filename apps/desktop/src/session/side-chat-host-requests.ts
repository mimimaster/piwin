import type { HostCommand, HostResponse } from '@piwin/contracts';

export type SideChatHostRequest = (
  command: HostCommand,
  options?: { idempotencyKey?: string },
) => Promise<HostResponse>;

export async function abortSideChatRun(args: {
  request: SideChatHostRequest;
  sessionId: string;
  runId: string | null;
  createIdempotencyKey: () => string;
}): Promise<HostResponse | undefined> {
  const runId = args.runId?.trim() ?? '';
  if (runId.length === 0) {
    return undefined;
  }
  return args.request(
    { type: 'session/abort', sessionId: args.sessionId, runId },
    { idempotencyKey: args.createIdempotencyKey() },
  );
}

/**
 * Closing a side-chat tab ends that side chat: stop its foreground run (if
 * any) and archive the session. Archive runs even when the abort fails so a
 * closed tab never leaves a live session behind; the archive result is what
 * the caller reports.
 */
export async function endSideChatSession(args: {
  request: SideChatHostRequest;
  sessionId: string;
  createIdempotencyKey: () => string;
}): Promise<HostResponse> {
  try {
    const foreground = await args.request({ type: 'session/foreground-run', sessionId: args.sessionId });
    const run = foreground.success
      ? ((foreground.data as { run?: { runId?: string } | null } | undefined)?.run ?? null)
      : null;
    await abortSideChatRun({
      request: args.request,
      sessionId: args.sessionId,
      runId: typeof run?.runId === 'string' ? run.runId : null,
      createIdempotencyKey: args.createIdempotencyKey,
    });
  } catch {
    // Abort is best-effort; archiving below still ends the side chat.
  }
  return args.request(
    { type: 'session/archive', sessionId: args.sessionId },
    { idempotencyKey: args.createIdempotencyKey() },
  );
}

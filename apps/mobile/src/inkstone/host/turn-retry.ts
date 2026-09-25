import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { createMobileIdempotencyKey, executeMobileMutation } from '../../mobile-prompt-send.js';

/**
 * Re-run a user turn (ADR 0064). The Host moves the active leaf back to that
 * user row and answers again; `keepPreviousAttempt` keeps the old answer as a
 * sibling ("换个回答"), otherwise it is replaced ("重试").
 */
export type TurnRetryResult =
  | { kind: 'started' }
  | { kind: 'needs-confirm'; files: string[] }
  | { kind: 'failed'; message: string };

export function buildTurnRetryCommand(input: {
  sessionId: string;
  userMessage: { id: string; text: string };
  keepPreviousAttempt: boolean;
  confirm: boolean;
}): Extract<HostCommand, { type: 'session/prompt' }> {
  return {
    type: 'session/prompt',
    sessionId: input.sessionId,
    input: {
      text: input.userMessage.text,
      retryUserMessageId: input.userMessage.id,
      ...(input.keepPreviousAttempt ? { keepPreviousAttempt: true } : {}),
    },
    foreground: { kind: 'if-idle' },
    ...(input.confirm ? { confirm: true } : {}),
  };
}

export function readTurnRetryResponse(response: HostResponse): TurnRetryResult {
  if (response.success) return { kind: 'started' };
  const problem = response.problem;
  if (problem?.code === 'retry-discards-writes') {
    const data: unknown = problem.data;
    const files = typeof data === 'object' && data !== null ? (data as { files?: unknown }).files : undefined;
    return {
      kind: 'needs-confirm',
      files: Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [],
    };
  }
  return { kind: 'failed', message: response.error };
}

export async function retryTurn(
  client: HostClient,
  input: Parameters<typeof buildTurnRetryCommand>[0],
): Promise<TurnRetryResult> {
  try {
    const response = await executeMobileMutation(
      (command, options) => client.request(command, options),
      buildTurnRetryCommand(input),
      createMobileIdempotencyKey(),
    );
    return readTurnRetryResponse(response);
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : '重试失败。' };
  }
}

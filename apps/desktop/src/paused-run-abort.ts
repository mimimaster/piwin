import type { HostCommand } from '@piwin/contracts';
import type { ChatUiState } from './chat-reducer.js';

/** Exact-run abort for a Host pause checkpoint. Omit runId must not go on the wire. */
export function buildPausedRunAbortCommand(
  state: Pick<ChatUiState, 'activeSessionId' | 'lastTerminalRunId' | 'runTerminal'>,
): Extract<HostCommand, { type: 'session/abort' }> | undefined {
  if (state.runTerminal.kind !== 'paused') {
    return undefined;
  }
  const sessionId = state.activeSessionId;
  const runId = state.lastTerminalRunId;
  if (sessionId === null || runId === null || runId.length === 0) {
    return undefined;
  }
  return { type: 'session/abort', sessionId, runId };
}

import { describe, expect, it } from 'vitest';
import { createInitialChatUiState } from './chat-reducer.js';
import { buildPausedRunAbortCommand } from './paused-run-abort.js';

describe('buildPausedRunAbortCommand', () => {
  it('returns session/abort with the paused run id', () => {
    const state = {
      ...createInitialChatUiState(),
      activeSessionId: 's1',
      lastTerminalRunId: 'run-paused',
      runTerminal: { kind: 'paused' as const, at: 1 },
    };
    expect(buildPausedRunAbortCommand(state)).toEqual({
      type: 'session/abort',
      sessionId: 's1',
      runId: 'run-paused',
    });
  });

  it('omits the command when the paused run id is unknown', () => {
    const state = {
      ...createInitialChatUiState(),
      activeSessionId: 's1',
      lastTerminalRunId: null,
      runTerminal: { kind: 'paused' as const, at: 1 },
    };
    expect(buildPausedRunAbortCommand(state)).toBeUndefined();
  });

  it('omits the command when the run is not paused', () => {
    const state = {
      ...createInitialChatUiState(),
      activeSessionId: 's1',
      lastTerminalRunId: 'run-done',
      runTerminal: { kind: 'complete' as const, at: 1 },
    };
    expect(buildPausedRunAbortCommand(state)).toBeUndefined();
  });
});

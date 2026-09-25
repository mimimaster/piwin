import { describe, expect, it } from 'vitest';
import { buildTurnRetryCommand, readTurnRetryResponse } from './turn-retry.js';

describe('turn retry', () => {
  it('re-runs the user row instead of appending a new one', () => {
    expect(
      buildTurnRetryCommand({
        sessionId: 's1',
        userMessage: { id: 'u1', text: '再试一次' },
        keepPreviousAttempt: true,
        confirm: false,
      }),
    ).toEqual({
      type: 'session/prompt',
      sessionId: 's1',
      input: { text: '再试一次', retryUserMessageId: 'u1', keepPreviousAttempt: true },
      foreground: { kind: 'if-idle' },
    });
  });

  it('asks for confirmation when the Host would discard written files', () => {
    expect(
      readTurnRetryResponse({
        type: 'response',
        command: 'session/prompt',
        success: false,
        error: 'retry-discards-writes: a.ts',
        problem: { code: 'retry-discards-writes', data: { files: ['a.ts'] } },
      }),
    ).toEqual({ kind: 'needs-confirm', files: ['a.ts'] });
    expect(
      readTurnRetryResponse({ type: 'response', command: 'session/prompt', success: false, error: 'busy' }),
    ).toEqual({ kind: 'failed', message: 'busy' });
  });
});

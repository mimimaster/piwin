import { describe, expect, it } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { buildMobileSessionPrompt, readMobilePromptFailure } from './mobile-prompt-send.js';

describe('mobile prompt send', () => {
  it('always admits with if-idle unless replacing a named run', () => {
    expect(
      buildMobileSessionPrompt({ sessionId: 's1', text: 'hello' }).foreground,
    ).toEqual({ kind: 'if-idle' });
    expect(
      buildMobileSessionPrompt({
        sessionId: 's1',
        text: 'hello',
        replaceRunId: 'run-a',
      }).foreground,
    ).toEqual({ kind: 'replace-run', runId: 'run-a' });
  });

  it('surfaces foreground-run-mismatch with the live run id', () => {
    const response: HostResponse = {
      type: 'response',
      command: 'session/prompt',
      success: false,
      error: 'foreground-run-mismatch: session is busy',
      problem: {
        code: 'foreground-run-mismatch',
        data: { reason: 'active', actualRun: { runId: 'run-a' } },
      },
    };
    expect(readMobilePromptFailure(response)).toEqual({
      message: 'foreground-run-mismatch: session is busy',
      replaceRunId: 'run-a',
    });
  });

  it('maps a missing-foreground problem without offering replace-run', () => {
    const response: HostResponse = {
      type: 'response',
      command: 'session/prompt',
      success: false,
      error: 'Remote session/prompt requires foreground admission',
      problem: { code: 'command-not-allowed', data: { reason: 'foreground-required' } },
    };
    expect(readMobilePromptFailure(response)).toEqual({
      message: 'Remote session/prompt requires foreground admission',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createUnknownAgentFailure } from './agent-failure.js';
import {
  ABORTED_PROMPT_OUTCOME,
  COMPLETED_STOP_OUTCOME,
  isAgentPromptOutcome,
  mapNativeStopReason,
} from './agent-prompt-outcome.js';

describe('AgentPromptOutcome', () => {
  it('narrows the completed/failed/aborted union exhaustively', () => {
    const outcomes = [
      COMPLETED_STOP_OUTCOME,
      { status: 'completed' as const, stopReason: 'length' as const },
      { status: 'completed' as const, stopReason: 'toolUse' as const },
      { status: 'completed' as const, stopReason: 'handled' as const },
      {
        status: 'failed' as const,
        stopReason: 'error' as const,
        failure: createUnknownAgentFailure('boom'),
      },
      ABORTED_PROMPT_OUTCOME,
    ];
    for (const outcome of outcomes) {
      expect(isAgentPromptOutcome(outcome)).toBe(true);
      switch (outcome.status) {
        case 'completed':
          expect(['stop', 'length', 'toolUse', 'handled']).toContain(outcome.stopReason);
          break;
        case 'failed':
          expect(outcome.stopReason).toBe('error');
          expect(outcome.failure.code).toBeDefined();
          break;
        case 'aborted':
          expect(outcome.stopReason).toBe('aborted');
          break;
        default: {
          const _never: never = outcome;
          expect(_never).toBeUndefined();
        }
      }
    }
  });

  it('omits aborted message unless provided', () => {
    expect('message' in ABORTED_PROMPT_OUTCOME).toBe(false);
    expect(
      isAgentPromptOutcome({ status: 'aborted', stopReason: 'aborted', message: 'user stop' }),
    ).toBe(true);
  });

  it('maps native stop reasons without silently completing unknowns', () => {
    expect(mapNativeStopReason('stop')).toEqual(COMPLETED_STOP_OUTCOME);
    expect(mapNativeStopReason('length').stopReason).toBe('length');
    expect(mapNativeStopReason('toolUse').stopReason).toBe('toolUse');
    expect(mapNativeStopReason('handled').stopReason).toBe('handled');
    expect(mapNativeStopReason('aborted')).toEqual(ABORTED_PROMPT_OUTCOME);
    expect(mapNativeStopReason('error').status).toBe('failed');
    const unexpected = mapNativeStopReason('nonsense');
    expect(unexpected).toMatchObject({
      status: 'failed',
      stopReason: 'error',
      failure: { code: 'backend-protocol-error', origin: 'protocol', retriable: false },
    });
  });

  it('round-trips through JSON for worker session/prompt data', () => {
    const outcome = mapNativeStopReason('error', {
      failure: createUnknownAgentFailure('Stream ended without finish_reason'),
    });
    const frame = { type: 'response', id: '1', success: true, data: outcome };
    const parsed = JSON.parse(JSON.stringify(frame)) as unknown;
    expect(isAgentPromptOutcome((parsed as { data: unknown }).data)).toBe(true);
  });

  it('rejects incomplete failed outcomes', () => {
    expect(isAgentPromptOutcome({ status: 'failed', stopReason: 'error' })).toBe(false);
    expect(isAgentPromptOutcome({ status: 'completed', stopReason: 'error' })).toBe(false);
  });
});

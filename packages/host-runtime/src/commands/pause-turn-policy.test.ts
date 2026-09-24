import { describe, expect, it } from 'vitest';
import {
  capturePausedTurnPolicy,
  requestedTurnPolicy,
  resumeTurnPolicyInput,
} from './pause-turn-policy.js';

describe('pause turn policy', () => {
  it('records the requested scheme and a disabled delegation', () => {
    expect(
      requestedTurnPolicy({ orchestrationSchemeId: ' fusion ', delegationMode: 'disabled' }, false),
    ).toEqual({ orchestrationSchemeId: 'fusion', delegationMode: 'disabled' });
  });

  it('records nothing for a freehand send', () => {
    expect(requestedTurnPolicy({}, false)).toBeUndefined();
    expect(requestedTurnPolicy({ orchestrationSchemeId: 'off' }, false)).toBeUndefined();
  });

  it('never gives a conversation a scheme and keeps it non-delegating', () => {
    expect(requestedTurnPolicy({ orchestrationSchemeId: 'fusion' }, true)).toEqual({
      delegationMode: 'disabled',
    });
  });

  it('replays the captured policy into the resume prompt', () => {
    const policy = capturePausedTurnPolicy(
      { getRunTurnPolicy: (runId) => (runId === 'run-1' ? { orchestrationSchemeId: 'fusion' } : undefined) },
      'run-1',
    );
    expect(resumeTurnPolicyInput(policy)).toEqual({ orchestrationSchemeId: 'fusion' });
    expect(resumeTurnPolicyInput(undefined)).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { isSafeRemoteCommand } from './remote-command-validation.js';

describe('isSafeRemoteCommand session handoff', () => {
  it('accepts a handoff summary read for a safe session id', () => {
    expect(isSafeRemoteCommand({ type: 'session/handoff-summary', sessionId: 'session-1' })).toBe(
      true,
    );
    expect(isSafeRemoteCommand({ type: 'session/handoff-summary', sessionId: '' })).toBe(false);
  });
});

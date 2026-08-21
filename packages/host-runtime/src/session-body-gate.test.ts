import { describe, expect, it } from 'vitest';
import { SessionBodyGate, sessionBusyResponse } from './session-body-gate.js';

describe('SessionBodyGate', () => {
  it('admits one reservation per session', () => {
    const gate = new SessionBodyGate();
    expect(gate.tryReserve('s1')).toBe(true);
    expect(gate.tryReserve('s1')).toBe(false);
    expect(gate.isReserved('s1')).toBe(true);
    gate.release('s1');
    expect(gate.tryReserve('s1')).toBe(true);
  });

  it('returns a typed session-busy problem', () => {
    const response = sessionBusyResponse(undefined, 'session/prompt', 's1', 'body-job');
    expect(response.success).toBe(false);
    if (response.success) {
      throw new Error('expected failure');
    }
    expect(response.problem).toEqual({
      code: 'session-busy',
      data: { sessionId: 's1', reason: 'body-job' },
    });
  });
});

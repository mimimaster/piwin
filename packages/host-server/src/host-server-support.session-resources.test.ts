import { describe, expect, it } from 'vitest';
import { isSafeRemoteCommand } from './host-server-support.js';

describe('isSafeRemoteCommand session/resources', () => {
  it('admits a session-scoped read', () => {
    expect(isSafeRemoteCommand({ type: 'session/resources', sessionId: 'sess-1' })).toBe(true);
  });

  it('rejects a missing session id without throwing', () => {
    expect(isSafeRemoteCommand({ type: 'session/resources' } as never)).toBe(false);
  });
});

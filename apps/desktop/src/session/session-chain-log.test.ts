import { describe, expect, it, vi } from 'vitest';
import { logSessionChain, sessionChainErrorCode } from './session-chain-log';

describe('sessionChainErrorCode', () => {
  it('never returns a long body and prefers Error.name', () => {
    expect(sessionChainErrorCode(new Error('secret prompt text'))).toBe('Error');
    expect(sessionChainErrorCode('host-unavailable')).toBe('host-unavailable');
    expect(sessionChainErrorCode('x'.repeat(200)).length).toBeLessThanOrEqual(120);
  });
});

describe('logSessionChain', () => {
  it('emits structured fields without requiring a body', () => {
    const previous = process.env['VITEST'];
    delete process.env['VITEST'];
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    logSessionChain({
      event: 'send/start',
      operationId: 'op-1',
      owner: 'draft-1',
      scopeKey: 'general',
    });
    expect(debug).toHaveBeenCalledWith('[piwin.session-chain]', {
      event: 'send/start',
      operationId: 'op-1',
      owner: 'draft-1',
      scopeKey: 'general',
    });
    debug.mockRestore();
    if (previous !== undefined) {
      process.env['VITEST'] = previous;
    }
  });
});

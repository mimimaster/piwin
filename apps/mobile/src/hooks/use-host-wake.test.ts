import { describe, expect, it } from 'vitest';
import { decideHostWake } from './use-host-wake.js';

describe('decideHostWake', () => {
  it('leaves it to the transport when it probed or redialled', () => {
    expect(decideHostWake({ kind: 'ready' }, true)).toBe('none');
    expect(decideHostWake({ kind: 'disconnected' }, true)).toBe('none');
  });

  it('rebuilds the connection when the transport is closed for good after a failure', () => {
    expect(decideHostWake({ kind: 'error', reason: 'Host WebSocket closed before handshake (1006)' }, false)).toBe('redial');
    expect(decideHostWake({ kind: 'disconnected' }, false)).toBe('redial');
  });

  it('does not retry a rejection that only re-pairing can fix', () => {
    expect(
      decideHostWake({ kind: 'error', reason: 'Host rejected the connection (4004): Device credential is invalid' }, false),
    ).toBe('none');
  });

  it('does nothing without a client (user disconnected or never paired) or mid-dial', () => {
    expect(decideHostWake(undefined, false)).toBe('none');
    expect(decideHostWake({ kind: 'connecting' }, false)).toBe('none');
    expect(decideHostWake({ kind: 'ready' }, false)).toBe('none');
  });
});

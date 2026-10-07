import { describe, expect, it } from 'vitest';
import { createHostWakeHandler, decideHostWake, HOST_WAKE_DEBOUNCE_MS } from './host-wake.js';

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

describe('createHostWakeHandler', () => {
  function harness(state: { kind: 'ready' } | { kind: 'disconnected' }, woke: boolean) {
    let clock = 10_000;
    let hidden = false;
    const calls = { wake: 0, redial: 0 };
    const handler = createHostWakeHandler({
      getClient: () => ({
        wake: () => {
          calls.wake += 1;
          return woke;
        },
        getState: () => state,
      }),
      redial: () => {
        calls.redial += 1;
      },
      isHidden: () => hidden,
      now: () => clock,
    });
    return {
      handler,
      calls,
      advance: (ms: number) => {
        clock += ms;
      },
      setHidden: (value: boolean) => {
        hidden = value;
      },
    };
  }

  it('wakes the transport once for a burst of foreground events', () => {
    const { handler, calls, advance } = harness({ kind: 'ready' }, true);
    handler();
    handler();
    advance(HOST_WAKE_DEBOUNCE_MS - 1);
    handler();
    expect(calls.wake).toBe(1);
    advance(1);
    handler();
    expect(calls.wake).toBe(2);
    expect(calls.redial).toBe(0);
  });

  it('does nothing while the page is in the background', () => {
    const { handler, calls, setHidden } = harness({ kind: 'ready' }, true);
    setHidden(true);
    handler();
    expect(calls.wake).toBe(0);
  });

  it('redials when the transport had nothing left to wake', () => {
    const { handler, calls } = harness({ kind: 'disconnected' }, false);
    handler();
    expect(calls.redial).toBe(1);
  });
});

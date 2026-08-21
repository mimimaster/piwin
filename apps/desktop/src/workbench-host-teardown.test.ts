import { describe, expect, it } from 'vitest';
import { isWorkbenchHostTeardownError } from './workbench-host-teardown.js';

describe('isWorkbenchHostTeardownError', () => {
  it('recognizes the banner text from a disposed handshake', () => {
    expect(isWorkbenchHostTeardownError('Host transport closed')).toBe(true);
    expect(isWorkbenchHostTeardownError('Host transport is not open')).toBe(true);
    expect(isWorkbenchHostTeardownError('Host WebSocket is not open')).toBe(true);
    expect(isWorkbenchHostTeardownError('Host client closed')).toBe(true);
    expect(isWorkbenchHostTeardownError('Host connection closed')).toBe(true);
    expect(isWorkbenchHostTeardownError('Host heartbeat timed out')).toBe(true);
    expect(isWorkbenchHostTeardownError('Unable to send Host request: session/prompt')).toBe(true);
    expect(isWorkbenchHostTeardownError('WebSocket closed (1006)')).toBe(true);
  });

  it('does not swallow real connect failures', () => {
    expect(isWorkbenchHostTeardownError('The operation is insecure.')).toBe(false);
    expect(isWorkbenchHostTeardownError('Origin not allowed')).toBe(false);
  });
});

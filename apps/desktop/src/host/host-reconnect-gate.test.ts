import { describe, expect, it } from 'vitest';
import {
  shouldBlockRemoteHostGesture,
  shouldShowHostReconnectBanner,
} from './host-reconnect-gate.js';

describe('shouldBlockRemoteHostGesture', () => {
  it('blocks remote clicks while the workbench is offline', () => {
    expect(
      shouldBlockRemoteHostGesture({ getTransport: () => 'remote', isReady: () => false }),
    ).toBe(true);
  });

  it('does not block a live sidecar or a ready remote socket', () => {
    expect(shouldBlockRemoteHostGesture({ getTransport: () => 'live', isReady: () => false })).toBe(
      false,
    );
    expect(shouldBlockRemoteHostGesture({ getTransport: () => 'remote', isReady: () => true })).toBe(
      false,
    );
  });
});

describe('shouldShowHostReconnectBanner', () => {
  it('hides when the remote socket is admitted, even if reducer hostReady is stale', () => {
    expect(shouldShowHostReconnectBanner({ transport: 'remote', wireReady: true })).toBe(false);
  });

  it('shows only when the remote socket is down', () => {
    expect(shouldShowHostReconnectBanner({ transport: 'remote', wireReady: false })).toBe(true);
    expect(shouldShowHostReconnectBanner({ transport: 'live', wireReady: false })).toBe(false);
  });
});

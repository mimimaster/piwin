// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearDesktopRemoteHostTarget,
  createDesktopRemoteHostClient,
  createDesktopRemoteHostProbeClientId,
  DESKTOP_REMOTE_HOST_CLIENT_CAPABILITIES,
  loadDesktopRemoteHostTarget,
  resolveDesktopRemoteHostClientOptions,
  sameDesktopRemoteHostTarget,
  saveDesktopRemoteHostTarget,
} from './remote-host-session';

const STORAGE_KEY = 'piwin.desktop.remote-host-target';

describe('desktop remote host target', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns undefined when no remote target is saved', () => {
    localStorage.clear();
    expect(loadDesktopRemoteHostTarget()).toBeUndefined();
  });

  it('round-trips endpoint and token', () => {
    saveDesktopRemoteHostTarget({ endpoint: 'ws://127.0.0.1:8787', authToken: 'secret' });
    expect(loadDesktopRemoteHostTarget()).toEqual({
      endpoint: 'ws://127.0.0.1:8787',
      authToken: 'secret',
    });
  });

  it('treats an empty endpoint as no remote target', () => {
    saveDesktopRemoteHostTarget({ endpoint: '   ' });
    expect(loadDesktopRemoteHostTarget()).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('omits an empty token from the persisted target', () => {
    saveDesktopRemoteHostTarget({ endpoint: 'wss://host.example:8787', authToken: '' });
    expect(loadDesktopRemoteHostTarget()).toEqual({
      endpoint: 'wss://host.example:8787',
    });
  });

  it('clears a saved target so the next launch uses the local sidecar', () => {
    saveDesktopRemoteHostTarget({ endpoint: 'ws://127.0.0.1:8787', authToken: 'secret' });
    clearDesktopRemoteHostTarget();
    expect(loadDesktopRemoteHostTarget()).toBeUndefined();
  });

  it('rejects non-ws endpoints on load', () => {
    window.localStorage.setItem(
      'piwin.desktop.remote-host-target',
      JSON.stringify({ endpoint: 'http://127.0.0.1:8787' }),
    );
    expect(loadDesktopRemoteHostTarget()).toBeUndefined();
  });

  it('returns undefined when stored JSON is invalid', () => {
    localStorage.setItem(STORAGE_KEY, '{');
    expect(loadDesktopRemoteHostTarget()).toBeUndefined();
  });

  it('does not ask Host for hello hydration; Desktop lists sessions itself', () => {
    expect(DESKTOP_REMOTE_HOST_CLIENT_CAPABILITIES.hydration).toBe(false);
  });

  it('reconnects the live workbench client and isolates probe ids', () => {
    expect(resolveDesktopRemoteHostClientOptions().autoReconnect).toBe(true);
    expect(resolveDesktopRemoteHostClientOptions({ autoReconnect: false }).autoReconnect).toBe(
      false,
    );
    expect(createDesktopRemoteHostProbeClientId().startsWith('desktop-probe-')).toBe(true);
  });

  it('creates a remote HostClient without connecting', () => {
    const client = createDesktopRemoteHostClient({
      endpoint: 'ws://127.0.0.1:8787',
      authToken: 'secret',
    });
    expect(client.getState().kind).toBe('idle');
  });

  it('treats the same endpoint and token as the same target', () => {
    expect(
      sameDesktopRemoteHostTarget(
        { endpoint: 'ws://127.0.0.1:8787' },
        { endpoint: 'ws://127.0.0.1:8787' },
      ),
    ).toBe(true);
    expect(
      sameDesktopRemoteHostTarget(
        { endpoint: 'ws://127.0.0.1:8787' },
        { endpoint: 'ws://127.0.0.1:9999' },
      ),
    ).toBe(false);
  });
});

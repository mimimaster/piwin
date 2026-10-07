// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDeviceCredentialVault } from '@piwin/host-client';
import {
  peekDeviceCredential,
  rememberDeviceCredential,
  setDeviceCredentialVaultForTesting,
} from './device-admission.js';
import type { HostClientState } from '@piwin/host-client';
import {
  ROAM_AFTER_UNREACHABLE_MS,
  alternateHostEndpoints,
  attachHostEndpointRoaming,
  rememberHostEndpoints,
  roamToReachableHostEndpoint,
} from './host-endpoint-roaming.js';

const WIFI = 'ws://192.168.1.20:8790';
const NEW_WIFI = 'ws://10.0.0.7:8790';
const TAILSCALE = 'ws://100.101.102.103:8790';
const CREDENTIAL = { deviceId: 'device-1', deviceSecret: 'secret' };

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe('Host endpoint roaming', () => {
  beforeEach(() => {
    setDeviceCredentialVaultForTesting(createMemoryDeviceCredentialVault());
  });

  afterEach(() => {
    setDeviceCredentialVaultForTesting(undefined);
  });

  it('remembers the other addresses of the connected Host, best first', () => {
    const storage = memoryStorage();
    rememberHostEndpoints(WIFI, [WIFI, TAILSCALE, 'not-a-url', TAILSCALE], storage);
    expect(alternateHostEndpoints(WIFI, storage)).toEqual([TAILSCALE]);
    expect(alternateHostEndpoints(TAILSCALE, storage)).toEqual([WIFI]);
  });

  it('offers nothing for a Host the list does not describe', () => {
    const storage = memoryStorage();
    rememberHostEndpoints(WIFI, [TAILSCALE], storage);
    expect(alternateHostEndpoints('ws://192.168.9.9:8790', storage)).toEqual([]);

    // A Host with a single address has nowhere to roam to.
    rememberHostEndpoints(WIFI, [WIFI], storage);
    expect(alternateHostEndpoints(WIFI, storage)).toEqual([]);
  });

  it('adopts the best address that admits this device and keeps the credential with it', async () => {
    const storage = memoryStorage();
    await rememberDeviceCredential(WIFI, CREDENTIAL);
    rememberHostEndpoints(WIFI, [NEW_WIFI, TAILSCALE], storage);

    const dialled: string[] = [];
    const target = await roamToReachableHostEndpoint(
      { endpoint: WIFI },
      {
        storage,
        probe: async (endpoint) => {
          dialled.push(endpoint);
          // The credential must already be presentable when the probe dials.
          expect(peekDeviceCredential(endpoint)).toEqual(CREDENTIAL);
          return true;
        },
      },
    );

    expect(dialled.sort()).toEqual([NEW_WIFI, TAILSCALE].sort());
    expect(target).toEqual({ endpoint: NEW_WIFI });
    expect(peekDeviceCredential(NEW_WIFI)).toEqual(CREDENTIAL);
    // The address that also answered but was not chosen holds nothing.
    expect(peekDeviceCredential(TAILSCALE)).toBeUndefined();
  });

  it('falls back to Tailscale when the LAN address is gone', async () => {
    const storage = memoryStorage();
    await rememberDeviceCredential(WIFI, CREDENTIAL);
    rememberHostEndpoints(WIFI, [NEW_WIFI, TAILSCALE], storage);

    const target = await roamToReachableHostEndpoint(
      { endpoint: WIFI },
      { storage, probe: async (endpoint) => endpoint === TAILSCALE },
    );

    expect(target).toEqual({ endpoint: TAILSCALE });
    expect(peekDeviceCredential(NEW_WIFI)).toBeUndefined();
  });

  it('stays put when nothing answers or the device is not paired', async () => {
    const storage = memoryStorage();
    rememberHostEndpoints(WIFI, [TAILSCALE], storage);

    // Unpaired: nothing proves another address is the same Host.
    let probed = 0;
    const unpaired = await roamToReachableHostEndpoint(
      { endpoint: WIFI },
      { storage, probe: async () => ((probed += 1), true) },
    );
    expect(unpaired).toBeUndefined();
    expect(probed).toBe(0);

    await rememberDeviceCredential(WIFI, CREDENTIAL);
    const unreachable = await roamToReachableHostEndpoint(
      { endpoint: WIFI },
      { storage, probe: async () => false },
    );
    expect(unreachable).toBeUndefined();
    expect(peekDeviceCredential(TAILSCALE)).toBeUndefined();
  });
});

describe('attachHostEndpointRoaming', () => {
  function fakeLink(initial: HostClientState) {
    let state = initial;
    const listeners = new Set<(state: HostClientState) => void>();
    return {
      link: {
        getState: () => state,
        subscribeState: (listener: (state: HostClientState) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        request: async () => ({
          type: 'response' as const,
          command: 'host/pairing-status' as const,
          success: true as const,
          data: {
            enabled: true,
            canManage: false,
            pairedDeviceCount: 1,
            hostInstanceId: 'host-1',
            endpointCandidates: [WIFI, TAILSCALE],
          },
        }),
      },
      set: (next: HostClientState) => {
        state = next;
        for (const listener of listeners) listener(next);
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.localStorage?.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('learns the Host addresses once the link is ready', async () => {
    const { link, set } = fakeLink({ kind: 'connecting' });
    const detach = attachHostEndpointRoaming({
      link,
      target: { endpoint: WIFI },
      onRoamed: () => undefined,
      roam: async () => undefined,
    });
    set({ kind: 'ready' });
    await vi.runAllTimersAsync();
    expect(alternateHostEndpoints(WIFI)).toEqual([TAILSCALE]);
    detach();
  });

  it('looks elsewhere only after the outage outlasts a normal reconnect', async () => {
    const { link, set } = fakeLink({ kind: 'ready' });
    const roam = vi.fn(async () => ({ endpoint: TAILSCALE }));
    const roamed: string[] = [];
    const detach = attachHostEndpointRoaming({
      link,
      target: { endpoint: WIFI },
      onRoamed: (target) => roamed.push(target.endpoint),
      roam,
    });

    set({ kind: 'disconnected' });
    await vi.advanceTimersByTimeAsync(ROAM_AFTER_UNREACHABLE_MS - 1);
    expect(roam).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(roam).toHaveBeenCalledTimes(1);
    expect(roamed).toEqual([TAILSCALE]);
    detach();
  });

  it('does not roam when the link came back by itself', async () => {
    const { link, set } = fakeLink({ kind: 'ready' });
    const roam = vi.fn(async () => undefined);
    const detach = attachHostEndpointRoaming({
      link,
      target: { endpoint: WIFI },
      onRoamed: () => undefined,
      roam,
    });
    set({ kind: 'disconnected' });
    await vi.advanceTimersByTimeAsync(2_000);
    set({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(ROAM_AFTER_UNREACHABLE_MS * 2);
    expect(roam).not.toHaveBeenCalled();
    detach();
  });
});

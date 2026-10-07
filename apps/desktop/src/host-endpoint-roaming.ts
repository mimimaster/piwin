/**
 * Finds a paired Host again after its address changed.
 *
 * A phone pairs with one address — usually the computer's Wi-Fi IP. When the
 * computer moves to another network, gets a new lease, or the phone leaves
 * the Wi-Fi but both are on Tailscale, that address is dead while the Host is
 * still reachable elsewhere. While connected the shell asks the Host for every
 * address it can be dialled on and remembers them; when the saved one stays
 * unreachable it tries the others and adopts the first that admits this
 * device.
 *
 * Only a paired device roams. Admission by the device credential is what
 * proves the other address is the same Host; an unpaired shell has nothing to
 * prove it with, and its user picks the Host by hand.
 */
import { readHostPairingStatusData, type HostResponse } from '@piwin/contracts';
import type { HostClientState } from '@piwin/host-client';
import {
  lendDeviceCredential,
  peekDeviceCredential,
  releasePrimedDeviceCredential,
  rememberDeviceCredential,
} from './device-admission.js';
import {
  createDesktopRemoteHostClient,
  createDesktopRemoteHostProbeClientId,
  isDesktopRemoteHostEndpoint,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';

const KNOWN_ENDPOINTS_KEY = 'piwin.desktop.remote-host-known-endpoints';
const MAX_KNOWN_ENDPOINTS = 8;

/** A dead address never answers; do not wait for the OS to give up on it. */
export const ROAM_PROBE_TIMEOUT_MS = 4_000;

type EndpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): EndpointStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readKnownEndpoints(storage: EndpointStorage | undefined): string[] {
  try {
    const raw = storage?.getItem(KNOWN_ENDPOINTS_KEY);
    if (raw === null || raw === undefined) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Record the addresses the connected Host reported. They replace whatever was
 * known before: the list describes one Host, the one just spoken to.
 */
export function rememberHostEndpoints(
  currentEndpoint: string,
  candidates: readonly string[],
  storage: EndpointStorage | undefined = defaultStorage(),
): void {
  const current = currentEndpoint.trim();
  const known = [current, ...candidates.map((item) => item.trim())]
    .filter((item, index, all) => isDesktopRemoteHostEndpoint(item) && all.indexOf(item) === index)
    .slice(0, MAX_KNOWN_ENDPOINTS);
  try {
    if (known.length <= 1) {
      storage?.removeItem(KNOWN_ENDPOINTS_KEY);
      return;
    }
    storage?.setItem(KNOWN_ENDPOINTS_KEY, JSON.stringify(known));
  } catch (error) {
    // Losing the list only costs a manual re-pair after an address change.
    console.warn('[piwin] could not remember Host addresses', error);
  }
}

/**
 * Other addresses of the Host saved as `currentEndpoint`, best first. Empty
 * when the remembered list belongs to a different Host.
 */
export function alternateHostEndpoints(
  currentEndpoint: string,
  storage: EndpointStorage | undefined = defaultStorage(),
): string[] {
  const current = currentEndpoint.trim();
  const known = readKnownEndpoints(storage);
  return known.includes(current) ? known.filter((item) => item !== current) : [];
}

export type RoamProbe = (endpoint: string) => Promise<boolean>;

/** Dial `endpoint` with this device's credential; true when the Host admits it. */
async function probeWithDeviceCredential(endpoint: string): Promise<boolean> {
  const probe = createDesktopRemoteHostClient(
    { endpoint },
    { autoReconnect: false, clientId: createDesktopRemoteHostProbeClientId() },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe timed out')), ROAM_PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    try {
      await probe.close();
    } catch {
      // The probe only answers "is the Host here"; the workbench owns the link.
    }
  }
}

/**
 * Try the Host's other addresses at once and adopt the best one that answers.
 * Resolves the new target, or `undefined` when this device is unpaired, knows
 * no other address, or none answered.
 */
export async function roamToReachableHostEndpoint(
  current: DesktopRemoteHostTarget,
  options: { probe?: RoamProbe; storage?: EndpointStorage } = {},
): Promise<DesktopRemoteHostTarget | undefined> {
  const currentEndpoint = current.endpoint.trim();
  const credential = peekDeviceCredential(currentEndpoint);
  if (credential === undefined) {
    return undefined;
  }
  const alternates = alternateHostEndpoints(currentEndpoint, options.storage ?? defaultStorage());
  if (alternates.length === 0) {
    return undefined;
  }
  const probe = options.probe ?? probeWithDeviceCredential;
  const answered = await Promise.all(
    alternates.map(async (endpoint) => {
      lendDeviceCredential(currentEndpoint, endpoint);
      const reachable = await probe(endpoint);
      if (!reachable) {
        releasePrimedDeviceCredential(endpoint);
      }
      return reachable;
    }),
  );
  // `alternates` is ordered best first (LAN before Tailscale); keep that order.
  const winnerIndex = answered.indexOf(true);
  if (winnerIndex < 0) {
    return undefined;
  }
  const winner = alternates[winnerIndex];
  if (winner === undefined) {
    return undefined;
  }
  for (const [index, endpoint] of alternates.entries()) {
    if (index !== winnerIndex && answered[index] === true) {
      releasePrimedDeviceCredential(endpoint);
    }
  }
  await rememberDeviceCredential(winner, credential);
  return { endpoint: winner };
}

/** How long the saved address may stay unreachable before others are tried. */
export const ROAM_AFTER_UNREACHABLE_MS = 6_000;
/** Probing costs the phone radio; a Host that is simply off is not re-probed in a loop. */
export const ROAM_RETRY_INTERVAL_MS = 20_000;

export type RoamingLink = {
  getState(): HostClientState;
  subscribeState(listener: (state: HostClientState) => void): () => void;
  request(command: { type: 'host/pairing-status' }): Promise<HostResponse>;
};

/**
 * Keep one Host link able to follow its Host: learn the Host's addresses each
 * time the link becomes ready, and when it stays down look for the Host on
 * the others. `onRoamed` receives the address to save; the shell reconnects
 * from there. Returns the detach handle.
 */
export function attachHostEndpointRoaming(input: {
  link: RoamingLink;
  target: DesktopRemoteHostTarget;
  onRoamed: (target: DesktopRemoteHostTarget) => void;
  roam?: (target: DesktopRemoteHostTarget) => Promise<DesktopRemoteHostTarget | undefined>;
  now?: () => number;
}): () => void {
  const roam = input.roam ?? ((target) => roamToReachableHostEndpoint(target));
  const now = input.now ?? Date.now;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let roaming = false;
  let lastRoamAt = Number.NEGATIVE_INFINITY;

  const cancelTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const learn = async (): Promise<void> => {
    try {
      const response = await input.link.request({ type: 'host/pairing-status' });
      if (disposed || !response.success) {
        return;
      }
      const status = readHostPairingStatusData(response.data);
      rememberHostEndpoints(input.target.endpoint, status?.endpointCandidates ?? []);
    } catch (error) {
      // An older Host has no such command; roaming is simply unavailable.
      console.warn('[piwin] could not read Host addresses', error);
    }
  };

  const lookElsewhere = async (): Promise<void> => {
    timer = undefined;
    if (disposed || roaming || isUp(input.link.getState())) {
      return;
    }
    roaming = true;
    lastRoamAt = now();
    try {
      const target = await roam(input.target);
      if (!disposed && target !== undefined) {
        input.onRoamed(target);
      }
    } catch (error) {
      console.warn('[piwin] looking for the Host on another address failed', error);
    } finally {
      roaming = false;
    }
  };

  const unsubscribe = input.link.subscribeState((state) => {
    if (state.kind === 'ready') {
      cancelTimer();
      void learn();
      return;
    }
    if (isUp(state) || timer !== undefined || roaming) {
      return;
    }
    const wait = Math.max(ROAM_AFTER_UNREACHABLE_MS, lastRoamAt + ROAM_RETRY_INTERVAL_MS - now());
    timer = setTimeout(() => {
      void lookElsewhere();
    }, wait);
  });

  return () => {
    disposed = true;
    cancelTimer();
    unsubscribe();
  };
}

/** `connecting` covers both a dial in flight and journal catch-up after hello. */
function isUp(state: HostClientState): boolean {
  return state.kind === 'ready' || state.kind === 'resync-required';
}

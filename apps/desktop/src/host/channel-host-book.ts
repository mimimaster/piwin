/**
 * ADR 0101 shell state for the workbench (Desktop thin shell, mobile shell,
 * browser): the host book in localStorage (no secrets) and per-Host secrets in
 * the platform's secret store — the OS credential store in both Tauri shells,
 * IndexedDB in a browser.
 *
 * Like device-admission.ts, entries and secrets are primed into memory so the
 * synchronous Host client factory can use them.
 */
import type { HostBookEntry, PairingLinkV3 } from '@piwin/contracts';
import {
  createChannelDialer,
  createNativeSecretStorage,
  HostBook,
  pairRemoteHost,
  RemoteHostVault,
  type KeyValueStorage,
  type RemoteHostSecrets,
} from '@piwin/host-client';
import { createNativeRelayInnerSocket, type RelayInnerSocketFactory } from '@piwin/host-transport';
import { describeThisDevice } from '../devices/device-admission.js';
import {
  hasTauriBridge,
  isDesktopTauriRuntime,
  isMobileTauriRuntime,
  readShellRuntime,
} from '../tool-cards/shell-runtime.js';

const primedEntries = new Map<string, HostBookEntry>();
const primedSecrets = new Map<string, RemoteHostSecrets>();
let sharedBook: HostBook | undefined;
let sharedVault: RemoteHostVault | undefined | null;

/** Where this runtime can keep channel secrets; undefined = channel pairing unavailable. */
function secretStorage(): KeyValueStorage | undefined {
  const invokeNative = async (command: string, args: Record<string, unknown>) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
  };
  if (isMobileTauriRuntime()) return createNativeSecretStorage(invokeNative);
  if (isDesktopTauriRuntime()) return createNativeSecretStorage(invokeNative, 'desktop_secret');
  if (readShellRuntime() === 'browser' && typeof indexedDB !== 'undefined') {
    return createIndexedDbStorage();
  }
  return undefined;
}

export function canPairOverChannel(): boolean {
  return channelVault() !== undefined;
}

export function channelHostBook(): HostBook {
  sharedBook ??= new HostBook(createLocalStorageStorage(), (error) =>
    console.warn('[piwin] host book was damaged and ignored', error),
  );
  return sharedBook;
}

/** This runtime's channel secret vault; undefined where secrets cannot be kept. */
export function channelVault(): RemoteHostVault | undefined {
  if (sharedVault === undefined) {
    const storage = secretStorage();
    sharedVault = storage === undefined ? null : new RemoteHostVault(storage);
  }
  return sharedVault ?? undefined;
}

/** The platform socket under the channel: the native plugin in Tauri, WebSocket in a browser. */
export function channelInnerSocketFactory(): RelayInnerSocketFactory {
  if (hasTauriBridge()) {
    return (url) =>
      createNativeRelayInnerSocket(url, async (endpoint) => {
        const { default: PluginWebSocket } = await import('@tauri-apps/plugin-websocket');
        return PluginWebSocket.connect(endpoint);
      });
  }
  // The DOM types declare handlers with an event argument; RelaySecureSocket
  // assigns zero-argument ones, which the browser calls just the same.
  return (url) => new WebSocket(url) as unknown as ReturnType<RelayInnerSocketFactory>;
}

/** Loads one Host's entry and secrets so `peekChannelHost` can return them synchronously. */
export async function primeChannelHost(hostId: string): Promise<boolean> {
  const vault = channelVault();
  const [entry, secrets] = await Promise.all([channelHostBook().get(hostId), vault?.read(hostId)]);
  if (entry === undefined || secrets === undefined) {
    primedEntries.delete(hostId);
    primedSecrets.delete(hostId);
    return false;
  }
  primedEntries.set(hostId, entry);
  primedSecrets.set(hostId, secrets);
  return true;
}

export function peekChannelHost(
  hostId: string,
): { entry: HostBookEntry; secrets: RemoteHostSecrets } | undefined {
  const entry = primedEntries.get(hostId);
  const secrets = primedSecrets.get(hostId);
  return entry === undefined || secrets === undefined ? undefined : { entry, secrets };
}

/** `host/hello` / `host/endpoints` moved this Host; keep memory and the book in step. */
export function updatePrimedChannelHost(entry: HostBookEntry): void {
  primedEntries.set(entry.hostId, entry);
}

/** Pairs with the Host behind a v3 link over the first reachable path. */
export async function pairWorkbenchChannelHost(input: {
  link: PairingLinkV3;
  clientId: string;
  clientVersion: string;
}): Promise<HostBookEntry> {
  const vault = channelVault();
  if (vault === undefined) {
    throw new Error('This app cannot store a channel pairing yet');
  }
  const entry = await pairRemoteHost({
    link: input.link,
    hostBook: channelHostBook(),
    vault,
    dial: createChannelDialer(channelInnerSocketFactory()),
    hello: {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'desktop',
      clientVersion: input.clientVersion,
      clientId: input.clientId,
      deviceName: describeThisDevice(),
    },
  });
  await primeChannelHost(entry.hostId);
  return entry;
}

/** First path a person would recognise: the relay, else the direct address. */
export function channelHostDisplayEndpoint(entry: HostBookEntry): string {
  return entry.relayUrl ?? entry.directUrl ?? '';
}

function createLocalStorageStorage(): KeyValueStorage {
  const storage = (): Storage | undefined => {
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  };
  return {
    read: async (key) => storage()?.getItem(key) ?? undefined,
    write: async (key, value) => storage()?.setItem(key, value),
    remove: async (key) => storage()?.removeItem(key),
  };
}

/** Browser secret store: one object store in its own database, never localStorage. */
function createIndexedDbStorage(): KeyValueStorage {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('piwin-remote-hosts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('secrets');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
    });
  const run = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ) => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = action(db.transaction('secrets', mode).objectStore('secrets'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      });
    } finally {
      db.close();
    }
  };
  return {
    read: async (key) => {
      const value = await run('readonly', (store) => store.get(key) as IDBRequest<unknown>);
      return typeof value === 'string' ? value : undefined;
    },
    write: async (key, value) => {
      await run('readwrite', (store) => store.put(value, key));
    },
    remove: async (key) => {
      await run('readwrite', (store) => store.delete(key));
    },
  };
}

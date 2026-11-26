/**
 * ADR 0101 channel pairing on the mobile shell: the Host book and the
 * last-picked Host id in localStorage (no secrets), per-Host client keys and
 * device credentials in `mobile_credential_*` (Keychain) with a memory
 * fallback in the web preview, and a WebSocket inner socket that prefers the
 * native plugin so `ws://` direct dials survive WKWebView's cleartext ban.
 */
import type {
  HostBookEntry,
  HostClientCapabilities,
  HostEndpointsData,
  PairingLinkV3,
} from '@piwin/contracts';
import {
  createChannelDialer,
  createMemoryKeyValueStorage,
  createNativeSecretStorage,
  createRemoteHostTransport,
  HostBook,
  HostClient,
  pairRemoteHost,
  RemoteHostVault,
  type ChannelDialer,
  type DeviceCredentialInvoke,
  type DialPath,
  type HostClientCursorStore,
  type HostClientLastSeqStore,
  type KeyValueStorage,
  type RemoteHostSecrets,
} from '@piwin/host-client';
import {
  createNativeRelayInnerSocket,
  type NativeHostWebSocketConnect,
  type RelayInnerSocket,
  type RelayInnerSocketFactory,
} from '@piwin/host-transport';
import { isNativeTauriRuntime } from './mobile-device-credential-vault.js';
import { mobileLocalStorage } from './mobile-local-storage.js';
import { connectTauriPluginWebSocket } from './tauri-host-websocket.js';
import {
  createLocalStorageCursorStore,
  createLocalStorageLastSeqStore,
  getOrCreateClientId,
  MOBILE_CLIENT_VERSION,
  MOBILE_CURSOR_KEY,
  MOBILE_LAST_SEQ_KEY,
} from './mobile-host-connection.js';

/** The last channel Host this device connected to, for cold-launch redial. */
export const MOBILE_LAST_CHANNEL_HOST_ID_KEY = 'piwin.mobile.last-channel-host-id.v1';

const MOBILE_DEVICE_NAME = 'Piwin mobile';

export function readLastMobileChannelHostId(): string | undefined {
  try {
    const raw = mobileLocalStorage()?.getItem(MOBILE_LAST_CHANNEL_HOST_ID_KEY)?.trim();
    return raw === undefined || raw.length === 0 ? undefined : raw;
  } catch (error) {
    console.warn('[piwin-mobile] failed to read remembered channel Host', error);
    return undefined;
  }
}

export function writeLastMobileChannelHostId(hostId: string): void {
  try {
    mobileLocalStorage()?.setItem(MOBILE_LAST_CHANNEL_HOST_ID_KEY, hostId.trim());
  } catch (error) {
    console.warn('[piwin-mobile] failed to remember channel Host', error);
  }
}

export function clearLastMobileChannelHostId(): void {
  try {
    mobileLocalStorage()?.removeItem(MOBILE_LAST_CHANNEL_HOST_ID_KEY);
  } catch (error) {
    console.warn('[piwin-mobile] failed to forget channel Host', error);
  }
}

/** The paired channel Hosts this device remembers; never holds secrets. */
export function mobileHostBook(storage?: KeyValueStorage): HostBook {
  return new HostBook(storage ?? createMobileLocalStorageStorage(), (error) =>
    console.warn('[piwin-mobile] host book was damaged and ignored', error),
  );
}

/** Per-Host channel secrets: Keychain in the app, memory in the web preview. */
export function mobileChannelVault(storage?: KeyValueStorage): RemoteHostVault {
  const resolved =
    storage ??
    (isNativeTauriRuntime() ? createNativeSecretStorage(invokeNative) : undefined) ??
    createMemoryKeyValueStorage();
  return new RemoteHostVault(resolved);
}

const invokeNative: DeviceCredentialInvoke = async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
};

/**
 * The platform socket under the channel. WKWebView refuses a cleartext
 * `ws://` dial from the app origin, so direct addresses go through the
 * Tauri WebSocket plugin; `wss://` (the relay) uses the WebView's own
 * WebSocket, which needs no workaround and keeps the dial off the plugin's
 * serialized operation queue.
 */
export function mobileChannelInnerSocketFactory(
  useNativePlugin: boolean = isNativeTauriRuntime(),
  connect: NativeHostWebSocketConnect = connectTauriPluginWebSocket,
): RelayInnerSocketFactory {
  const browserSocket = (url: string): RelayInnerSocket =>
    // The DOM types declare handlers with an event argument; RelaySecureSocket
    // assigns zero-argument ones, which the browser calls just the same.
    new WebSocket(url) as unknown as RelayInnerSocket;
  if (!useNativePlugin) {
    return browserSocket;
  }
  return (url) =>
    url.trim().toLowerCase().startsWith('wss://')
      ? browserSocket(url)
      : createNativeRelayInnerSocket(url, connect);
}

/** First address a person would recognise: the relay, else the direct address. */
export function displayEndpointForHostEntry(entry: HostBookEntry): string {
  return entry.relayUrl ?? entry.directUrl ?? entry.hostId;
}

/** Pairs with the Host behind a v3 link over the first reachable path. */
export async function pairMobileChannelHost(input: {
  link: PairingLinkV3;
  clientId?: string;
  clientVersion?: string;
  capabilities?: HostClientCapabilities;
  book?: HostBook;
  vault?: RemoteHostVault;
  dial?: ChannelDialer;
  innerSocketFactory?: RelayInnerSocketFactory;
}): Promise<{ entry: HostBookEntry; secrets: RemoteHostSecrets }> {
  const book = input.book ?? mobileHostBook();
  const vault = input.vault ?? mobileChannelVault();
  const clientId = input.clientId ?? getOrCreateClientId();
  const clientVersion = input.clientVersion ?? MOBILE_CLIENT_VERSION;
  const entry = await pairRemoteHost({
    link: input.link,
    hostBook: book,
    vault,
    dial:
      input.dial ??
      createChannelDialer(input.innerSocketFactory ?? mobileChannelInnerSocketFactory()),
    hello: {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion,
      clientId,
      deviceName: MOBILE_DEVICE_NAME,
      ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
    },
  });
  writeLastMobileChannelHostId(entry.hostId);
  const secrets = await vault.read(entry.hostId);
  if (secrets === undefined) {
    throw new Error('配对凭据未能写入本机存储，请断开后重新扫码配对。');
  }
  return { entry, secrets };
}

/**
 * Loads a paired channel Host for redial: `hostId` when given, else the last
 * one this device used. A missing entry forgets the remembered id; a missing
 * credential means this device's pairing was revoked or never persisted.
 */
export async function resolveSavedChannelHost(input: {
  book: HostBook;
  vault: RemoteHostVault;
  hostId?: string;
}): Promise<{ entry: HostBookEntry; secrets: RemoteHostSecrets } | undefined> {
  const targetHostId = input.hostId ?? readLastMobileChannelHostId();
  if (targetHostId === undefined) {
    return undefined;
  }
  const [entry, secrets] = await Promise.all([
    input.book.get(targetHostId),
    input.vault.read(targetHostId),
  ]);
  if (entry === undefined) {
    clearLastMobileChannelHostId();
    return undefined;
  }
  if (secrets === undefined) {
    throw new Error('此设备授权已失效，请断开后重新扫码配对。');
  }
  return { entry, secrets };
}

/**
 * Decides what one connect dial should target: a fresh v3 link pairs a new
 * Host; a saved channel Host (for a bare reconnect) resolves book + secrets;
 * anything else is a legacy/manual dial, which forgets the saved channel
 * Host so it no longer wins cold-launch redial. Returns the display endpoint
 * the connection UI should show for whatever was chosen.
 */
export async function resolveMobileChannelTarget(input: {
  channelLink?: PairingLinkV3 | undefined;
  /** True when the user is deliberately dialing a legacy/manual endpoint. */
  explicitConnect: boolean;
  allowSavedHost: boolean;
  book: HostBook;
  vault: RemoteHostVault;
}): Promise<{ entry: HostBookEntry; secrets: RemoteHostSecrets } | undefined> {
  if (input.channelLink !== undefined) {
    return pairMobileChannelHost({ link: input.channelLink, book: input.book, vault: input.vault });
  }
  if (input.explicitConnect) {
    clearLastMobileChannelHostId();
    return undefined;
  }
  if (input.allowSavedHost) {
    return resolveSavedChannelHost({ book: input.book, vault: input.vault });
  }
  return undefined;
}

/** A live channel HostClient: relay-first dial plan, encrypted, reconnecting. */
export function createMobileChannelHostClient(input: {
  entry: HostBookEntry;
  secrets: RemoteHostSecrets;
  clientId?: string;
  clientVersion?: string;
  capabilities: HostClientCapabilities;
  book?: HostBook;
  lastSeqStore?: HostClientLastSeqStore;
  cursorStore?: HostClientCursorStore;
  /** Called with the book entry after `host/hello` / `host/endpoints` refreshes it. */
  onEndpoints?: (entry: HostBookEntry | undefined) => void;
  onPath?: (path: DialPath | undefined) => void;
  innerSocketFactory?: RelayInnerSocketFactory;
}): HostClient {
  const { entry, secrets } = input;
  const clientId = input.clientId ?? getOrCreateClientId();
  const clientVersion = input.clientVersion ?? MOBILE_CLIENT_VERSION;
  const remote = createRemoteHostTransport({
    entry,
    clientKeyPair: secrets.clientKeyPair,
    createInnerSocket: input.innerSocketFactory ?? mobileChannelInnerSocketFactory(),
    // HostClient installs its own hello carrying the device credential.
    createHello: (lastSeq) => ({
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion,
      clientId,
      lastSeq,
    }),
    onEndpoints: (endpoints: HostEndpointsData) => {
      const book = input.book;
      if (book === undefined) {
        input.onEndpoints?.(undefined);
        return;
      }
      book
        .applyEndpoints(entry.hostId, endpoints)
        .then((updated) => input.onEndpoints?.(updated))
        .catch((error: unknown) =>
          console.warn('[piwin-mobile] host book update failed', error),
        );
    },
    ...(input.onPath === undefined ? {} : { onPath: input.onPath }),
    transportOptions: { autoReconnect: true, heartbeatIntervalMs: 30_000 },
  });
  const storageSuffix = encodeURIComponent(displayEndpointForHostEntry(entry));
  return new HostClient({
    transport: remote.transport,
    clientId,
    clientType: 'mobile',
    clientVersion,
    capabilities: input.capabilities,
    deviceCredential: secrets.credential,
    lastSeqStore:
      input.lastSeqStore ??
      createLocalStorageLastSeqStore(`${MOBILE_LAST_SEQ_KEY}.${storageSuffix}`),
    cursorStore:
      input.cursorStore ?? createLocalStorageCursorStore(`${MOBILE_CURSOR_KEY}.${storageSuffix}`),
  });
}

/** Forgets one paired channel Host: the remembered id, its secrets, its book entry. */
export async function clearMobileChannelHost(input: {
  hostId: string | undefined;
  book: HostBook;
  vault: RemoteHostVault;
}): Promise<void> {
  clearLastMobileChannelHostId();
  if (input.hostId === undefined) {
    return;
  }
  try {
    await input.vault.clear(input.hostId);
  } catch (error) {
    console.warn('[piwin-mobile] failed to clear channel secrets', error);
  }
  try {
    await input.book.remove(input.hostId);
  } catch (error) {
    console.warn('[piwin-mobile] failed to remove channel Host entry', error);
  }
}

function createMobileLocalStorageStorage(): KeyValueStorage {
  return {
    read: async (key) => mobileLocalStorage()?.getItem(key) ?? undefined,
    write: async (key, value) => {
      mobileLocalStorage()?.setItem(key, value);
    },
    remove: async (key) => {
      mobileLocalStorage()?.removeItem(key);
    },
  };
}

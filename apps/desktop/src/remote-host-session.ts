import type { HostClientCapabilities } from '@piwin/contracts';
import {
  HostClient,
  type HostClientCursor,
  type HostClientCursorStore,
  type HostClientLastSeqStore,
} from '@piwin/host-client';
import { WebSocketHostTransport } from '@piwin/host-transport';
import { isTauriRuntime } from './tauri-pty.js';
import { createTauriHostWebSocket } from './tauri-host-websocket.js';

/** Keep in sync with apps/desktop/package.json version for Host minClient checks. */
export const DESKTOP_HOST_CLIENT_VERSION = '0.0.0';

export type DesktopRemoteHostTarget = {
  endpoint: string;
  authToken?: string;
};

/**
 * Desktop already hydrates sidebars via `session/list`. Hello hydration is a
 * mobile continuity dump; advertising it makes Host rebuild a 200-session
 * frame on every stale-cursor / Host-restart connect. Snapshot frames are
 * forwarded so bootstrap can force session/transcript catch-up.
 */
export const DESKTOP_REMOTE_HOST_CLIENT_CAPABILITIES: HostClientCapabilities = {
  pushBatching: true,
  cursorBatches: true,
  boundedReplay: true,
  hydration: false,
  liveSubscriptions: true,
};

const TARGET_KEY = 'piwin.desktop.remote-host-target';
const CLIENT_ID_KEY = 'piwin.desktop.remote-client-id';
const LAST_SEQ_KEY = 'piwin.desktop.remote-last-seq';
const CURSOR_KEY = 'piwin.desktop.remote-cursor';

const targetListeners = new Set<() => void>();

export function loadDesktopRemoteHostTarget(): DesktopRemoteHostTarget | undefined {
  const raw = getLocalStorage()?.getItem(TARGET_KEY);
  if (raw === null || raw === undefined || raw.length === 0) {
    return undefined;
  }
  try {
    return parseDesktopRemoteHostTarget(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

export function saveDesktopRemoteHostTarget(target: DesktopRemoteHostTarget): void {
  const normalized = parseDesktopRemoteHostTarget(target);
  if (normalized === undefined) {
    clearDesktopRemoteHostTarget();
    return;
  }
  const serialized = JSON.stringify(normalized);
  const storage = getLocalStorage();
  const previous = storage?.getItem(TARGET_KEY);
  storage?.setItem(TARGET_KEY, serialized);
  if (previous !== serialized) {
    notifyDesktopRemoteHostTargetListeners();
  }
}

export function clearDesktopRemoteHostTarget(): void {
  const storage = getLocalStorage();
  const previous = storage?.getItem(TARGET_KEY);
  storage?.removeItem(TARGET_KEY);
  if (previous !== null && previous !== undefined) {
    notifyDesktopRemoteHostTargetListeners();
  }
}

export function subscribeDesktopRemoteHostTargetChange(listener: () => void): () => void {
  targetListeners.add(listener);
  return () => {
    targetListeners.delete(listener);
  };
}

export type DesktopRemoteHostClientOptions = {
  autoReconnect?: boolean;
  clientId?: string;
};

export type LiveDesktopRemoteHostStatus =
  | { ok: true; hostInstanceId?: string }
  | { ok: false; error: string };

export type LiveDesktopRemoteHostHandle = {
  target: DesktopRemoteHostTarget;
  isReady: () => boolean;
  requestStatus: () => Promise<LiveDesktopRemoteHostStatus>;
};

let liveDesktopRemoteHost: LiveDesktopRemoteHostHandle | undefined;

/** Workbench socket stays up across drops. Probe must pass `autoReconnect: false`. */
export function resolveDesktopRemoteHostClientOptions(
  options?: DesktopRemoteHostClientOptions,
): { autoReconnect: boolean; clientId?: string } {
  const clientId = options?.clientId?.trim();
  return {
    autoReconnect: options?.autoReconnect ?? true,
    ...(clientId !== undefined && clientId.length > 0 ? { clientId } : {}),
  };
}

export function createDesktopRemoteHostProbeClientId(): string {
  return `desktop-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function registerLiveDesktopRemoteHost(
  handle: LiveDesktopRemoteHostHandle,
): () => void {
  liveDesktopRemoteHost = handle;
  return () => {
    if (liveDesktopRemoteHost === handle) {
      liveDesktopRemoteHost = undefined;
    }
  };
}

export function peekLiveDesktopRemoteHost(): LiveDesktopRemoteHostHandle | undefined {
  return liveDesktopRemoteHost;
}

export function createDesktopRemoteHostClient(
  target: DesktopRemoteHostTarget,
  options?: DesktopRemoteHostClientOptions,
): HostClient {
  const resolved = resolveDesktopRemoteHostClientOptions(options);
  const endpoint = target.endpoint.trim();
  const storageSuffix = encodeURIComponent(endpoint);
  const transport = new WebSocketHostTransport({
    endpoint,
    autoReconnect: resolved.autoReconnect,
    heartbeatIntervalMs: 30_000,
    ...(isTauriRuntime() ? { webSocketFactory: createTauriHostWebSocket } : {}),
  });
  const authToken = target.authToken?.trim();
  return new HostClient({
    transport,
    clientId: resolved.clientId ?? getOrCreateClientId(),
    clientType: 'desktop',
    clientVersion: DESKTOP_HOST_CLIENT_VERSION,
    capabilities: DESKTOP_REMOTE_HOST_CLIENT_CAPABILITIES,
    ...(authToken === undefined || authToken.length === 0 ? {} : { authToken }),
    lastSeqStore: createLocalStorageLastSeqStore(`${LAST_SEQ_KEY}.${storageSuffix}`),
    cursorStore: createLocalStorageCursorStore(`${CURSOR_KEY}.${storageSuffix}`),
  });
}

export function isDesktopRemoteHostEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
}

/** Compact chip label for an attached Host: `hostname` or `hostname:port`. */
export function formatDesktopRemoteHostDisplay(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.trim();
    if (hostname.length === 0) {
      return undefined;
    }
    const host =
      hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
    return url.port.length > 0 ? `${host}:${url.port}` : host;
  } catch {
    return undefined;
  }
}

export function readRemoteHostInstanceId(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  return typeof data.hostInstanceId === 'string' && data.hostInstanceId.length > 0
    ? data.hostInstanceId
    : undefined;
}

function parseDesktopRemoteHostTarget(value: unknown): DesktopRemoteHostTarget | undefined {
  if (!isRecord(value) || typeof value.endpoint !== 'string') {
    return undefined;
  }
  const endpoint = value.endpoint.trim();
  if (endpoint.length === 0) {
    return undefined;
  }
  if (!isRemoteHostEndpoint(endpoint)) {
    return undefined;
  }
  if (value.authToken === undefined) {
    return { endpoint };
  }
  if (typeof value.authToken !== 'string') {
    return undefined;
  }
  const authToken = value.authToken.trim();
  return authToken.length === 0 ? { endpoint } : { endpoint, authToken };
}

function isRemoteHostEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
}

function notifyDesktopRemoteHostTargetListeners(): void {
  for (const listener of targetListeners) {
    listener();
  }
}

function getOrCreateClientId(): string {
  const storage = getLocalStorage();
  const stored = storage?.getItem(CLIENT_ID_KEY);
  if (stored !== null && stored !== undefined && stored.length > 0) {
    return stored;
  }
  const uuid = (
    globalThis as unknown as {
      crypto?: { randomUUID?: () => string };
    }
  ).crypto?.randomUUID?.();
  const clientId =
    uuid ?? `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  storage?.setItem(CLIENT_ID_KEY, clientId);
  return clientId;
}

function createLocalStorageLastSeqStore(storageKey: string): HostClientLastSeqStore {
  return {
    read: () => {
      const raw = getLocalStorage()?.getItem(storageKey);
      const parsed = raw === null || raw === undefined ? 0 : Number(raw);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    },
    write: (lastSeq) => {
      getLocalStorage()?.setItem(storageKey, String(lastSeq));
    },
  };
}

function createLocalStorageCursorStore(storageKey: string): HostClientCursorStore {
  return {
    read: () => {
      const raw = getLocalStorage()?.getItem(storageKey);
      if (raw === null || raw === undefined) {
        return undefined;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        return isHostClientCursor(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    write: (cursor) => {
      getLocalStorage()?.setItem(storageKey, JSON.stringify(cursor));
    },
  };
}

function isHostClientCursor(value: unknown): value is HostClientCursor {
  if (!isRecord(value)) {
    return false;
  }
  const throughSeq = value.throughSeq;
  if (typeof throughSeq !== 'number' || !Number.isSafeInteger(throughSeq) || throughSeq < 0) {
    return false;
  }
  return value.hostInstanceId === undefined || typeof value.hostInstanceId === 'string';
}

function getLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function sameDesktopRemoteHostTarget(
  left: DesktopRemoteHostTarget | undefined,
  right: DesktopRemoteHostTarget | undefined,
): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  return left.endpoint === right.endpoint && left.authToken === right.authToken;
}

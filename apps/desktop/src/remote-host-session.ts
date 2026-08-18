import {
  HostClient,
  type HostClientCursor,
  type HostClientCursorStore,
  type HostClientLastSeqStore,
} from '@piwin/host-client';
import { WebSocketHostTransport } from '@piwin/host-transport';

export type DesktopRemoteHostTarget = {
  endpoint: string;
  authToken?: string;
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

export function createDesktopRemoteHostClient(target: DesktopRemoteHostTarget): HostClient {
  const endpoint = target.endpoint.trim();
  const storageSuffix = encodeURIComponent(endpoint);
  const transport = new WebSocketHostTransport({
    endpoint,
    autoReconnect: true,
    heartbeatIntervalMs: 30_000,
  });
  const authToken = target.authToken?.trim();
  return new HostClient({
    transport,
    clientId: getOrCreateClientId(),
    clientType: 'desktop',
    clientVersion: '0.0.0',
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
  if (value.authToken === undefined) {
    return { endpoint };
  }
  if (typeof value.authToken !== 'string') {
    return undefined;
  }
  const authToken = value.authToken.trim();
  return authToken.length === 0 ? { endpoint } : { endpoint, authToken };
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

import type { RemoteHostStatusData } from '@piwin/contracts';
import {
  HostClient,
  type HostClientCursor,
  type HostClientCursorStore,
  type HostClientLastSeqStore,
} from '@piwin/host-client';
import { WebSocketHostTransport } from '@piwin/host-transport';

const CLIENT_ID_KEY = 'piwin.mobile.client-id';
const LAST_SEQ_KEY = 'piwin.mobile.last-seq';
const CURSOR_KEY = 'piwin.mobile.cursor';

export function createMobileHostClient(endpoint: string, authToken?: string): HostClient {
  const storageSuffix = encodeURIComponent(endpoint.trim());
  const transport = new WebSocketHostTransport({
    endpoint,
    autoReconnect: true,
    heartbeatIntervalMs: 30_000,
  });
  return new HostClient({
    transport,
    clientId: getOrCreateClientId(),
    clientType: 'mobile',
    clientVersion: '0.0.0',
    ...(authToken === undefined || authToken.length === 0 ? {} : { authToken }),
    lastSeqStore: createLocalStorageLastSeqStore(`${LAST_SEQ_KEY}.${storageSuffix}`),
    cursorStore: createLocalStorageCursorStore(`${CURSOR_KEY}.${storageSuffix}`),
  });
}

export function getDefaultHostEndpoint(): string {
  const configured = import.meta.env.VITE_PIWIN_HOST_URL;
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured
    : 'ws://127.0.0.1:8787';
}

export function isRemoteHostStatusData(value: unknown): value is RemoteHostStatusData {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.hostInstanceId === 'string' &&
    (value.mode === 'sdk' || value.mode === 'rpc') &&
    typeof value.ready === 'boolean' &&
    typeof value.mock === 'boolean' &&
    typeof value.activeSessionCount === 'number' &&
    isRecord(value.capabilities)
  );
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
    uuid ?? `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

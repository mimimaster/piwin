import type {
  HostClientCapabilities,
  RemoteHostStatusData,
  TrustedDeviceCredential,
} from '@piwin/contracts';
import {
  HostClient,
  type HostClientCursor,
  type HostClientCursorStore,
  type HostClientLastSeqStore,
} from '@piwin/host-client';
import { WebSocketHostTransport } from '@piwin/host-transport';
import { isNativeTauriRuntime } from './mobile-device-credential-vault.js';
import { mobileLocalStorage } from './mobile-local-storage.js';
import { createTauriHostWebSocket } from './tauri-host-websocket.js';

const CLIENT_ID_KEY = 'piwin.mobile.client-id';
const LAST_SEQ_KEY = 'piwin.mobile.last-seq';
const CURSOR_KEY = 'piwin.mobile.cursor';

export type MobileHostConnectionInput = {
  endpoint: string;
  authToken: string;
  pairingToken: string;
  expectedHostInstanceId?: string;
};

export type MobileHostAdmission = {
  authToken?: string;
  pairingToken?: string;
  deviceCredential?: TrustedDeviceCredential;
  deviceName?: string;
  onIssuedDeviceCredential?: (credential: TrustedDeviceCredential) => Promise<void> | void;
};

export function createMobileHostClient(
  endpoint: string,
  admission: MobileHostAdmission = {},
  capabilities?: HostClientCapabilities,
): HostClient {
  const storageSuffix = encodeURIComponent(endpoint.trim());
  const transport = new WebSocketHostTransport({
    endpoint,
    autoReconnect: true,
    autoReconnectBeforeHandshake: false,
    heartbeatIntervalMs: 30_000,
    ...(isNativeTauriRuntime() ? { webSocketFactory: createTauriHostWebSocket } : {}),
  });
  const authToken = admission.authToken?.trim();
  const pairingToken = admission.pairingToken?.trim();
  return new HostClient({
    transport,
    clientId: getOrCreateClientId(),
    clientType: 'mobile',
    clientVersion: '0.0.0',
    ...(authToken === undefined || authToken.length === 0 ? {} : { authToken }),
    ...(pairingToken === undefined || pairingToken.length === 0 ? {} : { pairingToken }),
    ...(admission.deviceCredential === undefined
      ? {}
      : { deviceCredential: admission.deviceCredential }),
    ...(admission.deviceName === undefined || admission.deviceName.trim().length === 0
      ? {}
      : { deviceName: admission.deviceName.trim() }),
    ...(admission.onIssuedDeviceCredential === undefined
      ? {}
      : { onIssuedDeviceCredential: admission.onIssuedDeviceCredential }),
    lastSeqStore: createLocalStorageLastSeqStore(`${LAST_SEQ_KEY}.${storageSuffix}`),
    cursorStore: createLocalStorageCursorStore(`${CURSOR_KEY}.${storageSuffix}`),
    ...(capabilities === undefined ? {} : { capabilities }),
  });
}

export function getDefaultHostEndpoint(): string {
  const configured = import.meta.env.VITE_PIWIN_HOST_URL;
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured
    : 'ws://127.0.0.1:8787';
}

export function normalizeMobileHostEndpoint(rawEndpoint: string): string {
  const endpoint = rawEndpoint.trim();
  if (endpoint.length === 0) {
    throw new Error('请输入 Host 的 WebSocket 地址。');
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Host 地址格式不正确，请填写 ws:// 或 wss:// 开头的地址。');
  }
  if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') || parsed.hostname.length === 0) {
    throw new Error('Host 地址必须以 ws:// 或 wss:// 开头，例如 ws://192.168.1.100:8787。');
  }
  return endpoint;
}

export function formatMobileHostConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('This runtime does not provide a WebSocket implementation')) {
    return '当前环境未启用原生 WebSocket 通道，请升级至最新客户端。';
  }
  if (message.toLowerCase().includes('the operation is insecure')) {
    return '系统阻止了非安全 WebSocket 请求，请升级客户端以启用原生通信通道。';
  }
  if (
    message.includes('A paired device is required') ||
    message.includes('Host rejected the connection (4004)')
  ) {
    return 'Host 拒绝连接：配对码已失效或已使用，请重新生成配对码或提供访问口令。';
  }
  if (message.includes('Pairing token is invalid or expired')) {
    return '配对码已过期或已被使用，请在 Host 重新生成。';
  }
  if (message.includes('Device credential is invalid or revoked')) {
    return '此设备授权已失效，请断开后重新扫码配对。';
  }
  if (message.includes('Host authentication failed')) {
    return '访问口令不正确，请核对启动 Host 时设置的 PIWIN_HOST_TOKEN。';
  }
  if (
    message.includes('timed out') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENETUNREACH') ||
    message.includes('EHOSTUNREACH') ||
    message.includes('closed before handshake')
  ) {
    return '无法连通 Host：请检查网络连通性、Host 运行状态及端口设置。';
  }
  return `连接 Host 失败：${message}`;
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
  const storage = mobileLocalStorage();
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
      const raw = mobileLocalStorage()?.getItem(storageKey);
      const parsed = raw === null || raw === undefined ? 0 : Number(raw);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    },
    write: (lastSeq) => {
      mobileLocalStorage()?.setItem(storageKey, String(lastSeq));
    },
  };
}

function createLocalStorageCursorStore(storageKey: string): HostClientCursorStore {
  return {
    read: () => {
      const raw = mobileLocalStorage()?.getItem(storageKey);
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
      mobileLocalStorage()?.setItem(storageKey, JSON.stringify(cursor));
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


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

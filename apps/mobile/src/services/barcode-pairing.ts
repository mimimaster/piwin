import { Format, scan, cancel } from '@tauri-apps/plugin-barcode-scanner';

export type ParsedPairingData = {
  endpoint: string;
  /** Path A: shared Host door token from a legacy `{ token }` QR. */
  authToken?: string | undefined;
  /** Path B: one-time enrollment from a v2 QR or `piwin://pair?pairingToken=`. */
  pairingToken?: string | undefined;
  name?: string | undefined;
  hostInstanceId?: string | undefined;
  expiresAt?: number | undefined;
};

export function isNativeBarcodeAvailable(): boolean {
  return typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
}

export async function scanPairingQrCode(): Promise<ParsedPairingData> {
  if (!isNativeBarcodeAvailable()) {
    throw new Error('扫码仅在 iOS / Android App 内可用，请手动填写 Host 地址。');
  }

  const result = await scan({
    windowed: false,
    formats: [Format.QRCode],
  });

  if (!result || !result.content) {
    throw new Error('未检测到有效的二维码内容。');
  }

  return parsePairingString(result.content);
}

export async function cancelBarcodeScan(): Promise<void> {
  try {
    await cancel();
  } catch {
    // ignore
  }
}

export function parsePairingString(raw: string): ParsedPairingData {
  const trimmed = raw.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return parsePairingRecord(JSON.parse(trimmed) as unknown);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('配对')) {
        throw error;
      }
    }
  }

  if (
    trimmed.startsWith('piwin://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    try {
      return parsePairingUri(trimmed);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('配对')) {
        throw error;
      }
    }
  }

  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return { endpoint: trimmed };
  }

  throw new Error('二维码格式无法识别，请确保扫描的是 Piwin Host 生成的配对码。');
}

function parsePairingUri(raw: string): ParsedPairingData {
  const url = new URL(raw);
  const endpoint =
    url.searchParams.get('endpoint') ??
    `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
  const pairingToken = emptyToUndefined(url.searchParams.get('pairingToken'));
  const authToken = emptyToUndefined(url.searchParams.get('token'));
  const name = emptyToUndefined(url.searchParams.get('name'));
  const hostInstanceId = emptyToUndefined(url.searchParams.get('hostInstanceId'));
  const expiresAt = parseExpiresAt(url.searchParams.get('expiresAt'));
  return finalizePairing({
    endpoint,
    ...(pairingToken === undefined ? {} : { pairingToken }),
    ...(authToken === undefined ? {} : { authToken }),
    ...(name === undefined ? {} : { name }),
    ...(hostInstanceId === undefined ? {} : { hostInstanceId }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
}

function parsePairingRecord(value: unknown): ParsedPairingData {
  if (!isRecord(value) || typeof value.endpoint !== 'string' || value.endpoint.trim().length === 0) {
    throw new Error('二维码格式无法识别，请确保扫描的是 Piwin Host 生成的配对码。');
  }
  const pairingToken =
    typeof value.pairingToken === 'string' ? emptyToUndefined(value.pairingToken) : undefined;
  const authToken = typeof value.token === 'string' ? emptyToUndefined(value.token) : undefined;
  const name = typeof value.name === 'string' ? emptyToUndefined(value.name) : undefined;
  const hostInstanceId =
    typeof value.hostInstanceId === 'string' ? emptyToUndefined(value.hostInstanceId) : undefined;
  const expiresAt =
    typeof value.expiresAt === 'number'
      ? value.expiresAt
      : typeof value.expiresAt === 'string'
        ? parseExpiresAt(value.expiresAt)
        : undefined;
  return finalizePairing({
    endpoint: value.endpoint,
    ...(pairingToken === undefined ? {} : { pairingToken }),
    ...(authToken === undefined ? {} : { authToken }),
    ...(name === undefined ? {} : { name }),
    ...(hostInstanceId === undefined ? {} : { hostInstanceId }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
}

function finalizePairing(parsed: ParsedPairingData): ParsedPairingData {
  if (parsed.pairingToken !== undefined && parsed.authToken !== undefined) {
    throw new Error('配对码不能同时包含配对令牌和 Host 口令。');
  }
  if (parsed.expiresAt !== undefined && parsed.expiresAt <= Date.now()) {
    throw new Error('配对码已过期，请在 Host 上重新生成。');
  }
  return parsed;
}

function parseExpiresAt(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function emptyToUndefined(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

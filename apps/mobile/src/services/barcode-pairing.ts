import { Format, scan, cancel } from '@tauri-apps/plugin-barcode-scanner';

export type ParsedPairingData = {
  endpoint: string;
  token?: string | undefined;
  name?: string | undefined;
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

  // Format 1: JSON payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.endpoint === 'string' && parsed.endpoint.length > 0) {
        return {
          endpoint: parsed.endpoint,
          token: typeof parsed.token === 'string' ? parsed.token : undefined,
          name: typeof parsed.name === 'string' ? parsed.name : undefined,
        };
      }
    } catch {
      // fallback to URI parsing
    }
  }

  // Format 2: piwin:// or http(s):// or ws(s):// URI
  if (trimmed.startsWith('piwin://') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const endpoint = url.searchParams.get('endpoint') ?? `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
      const token = url.searchParams.get('token') ?? undefined;
      const name = url.searchParams.get('name') ?? undefined;
      return { endpoint, token, name };
    } catch {
      // fallback
    }
  }

  // Format 3: Raw ws:// or wss:// URL
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return { endpoint: trimmed };
  }

  throw new Error('二维码格式无法识别，请确保扫描的是 Piwin Desktop 或 CLI 生成的配对码。');
}

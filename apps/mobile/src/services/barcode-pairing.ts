import { Format, scan, cancel } from '@tauri-apps/plugin-barcode-scanner';
import {
  classifyPairingInput,
  parsePairingString,
  type PairingInput,
  type ParsedPairingData,
} from '@piwin/host-client';

export { classifyPairingInput, parsePairingString, type PairingInput, type ParsedPairingData };

export function isNativeBarcodeAvailable(): boolean {
  return typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
}

/**
 * A scanned QR: ADR 0101 v3 `piwin://pair?v=3&…` links classify as
 * `{ kind: 'channel' }`, every older format as `{ kind: 'legacy' }`.
 */
export async function scanPairingQrCode(): Promise<PairingInput> {
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

  return classifyPairingInput(result.content);
}

export async function cancelBarcodeScan(): Promise<void> {
  try {
    await cancel();
  } catch {
    // ignore
  }
}

import { Format, scan, cancel } from '@tauri-apps/plugin-barcode-scanner';
import { parsePairingString, type ParsedPairingData } from '@piwin/host-client';

export { parsePairingString, type ParsedPairingData };

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

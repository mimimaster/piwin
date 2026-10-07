/**
 * Camera scan of a Host pairing QR code. Only the mobile shell bundles the
 * barcode plugin; every other runtime has no scanner.
 */
import { parsePairingString, type ParsedPairingData } from '@piwin/host-client';
import { isMobileTauriRuntime } from './shell-runtime.js';

export function canScanPairingCode(): boolean {
  return isMobileTauriRuntime();
}

/** Resolves `undefined` when the camera closed without reading a code. */
export async function scanPairingCode(): Promise<ParsedPairingData | undefined> {
  const { Format, scan } = await import('@tauri-apps/plugin-barcode-scanner');
  const result = await scan({ windowed: false, formats: [Format.QRCode] });
  const content = result?.content?.trim() ?? '';
  if (content.length === 0) {
    return undefined;
  }
  return parsePairingString(content);
}

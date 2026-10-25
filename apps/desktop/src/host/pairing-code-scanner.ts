/**
 * Camera scan of a Host pairing QR code. Only the mobile shell bundles the
 * barcode plugin; every other runtime has no scanner.
 */
import { classifyPairingInput, type PairingInput } from '@piwin/host-client';
import { isMobileTauriRuntime } from '../tool-cards/shell-runtime.js';

export function canScanPairingCode(): boolean {
  return isMobileTauriRuntime();
}

/**
 * Resolves `undefined` when the camera closed without reading a code. A v3
 * code (ADR 0101) pairs over the channel; older codes keep the legacy path.
 */
export async function scanPairingCode(): Promise<PairingInput | undefined> {
  const { Format, scan } = await import('@tauri-apps/plugin-barcode-scanner');
  const result = await scan({ windowed: false, formats: [Format.QRCode] });
  const content = result?.content?.trim() ?? '';
  if (content.length === 0) {
    return undefined;
  }
  return classifyPairingInput(content);
}

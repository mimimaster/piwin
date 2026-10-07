import { describe, expect, it } from 'vitest';
import { isNativeBarcodeAvailable, scanPairingQrCode } from './barcode-pairing.js';

describe('barcode pairing scanner', () => {
  it('does not call Tauri invoke outside a native runtime', async () => {
    expect(isNativeBarcodeAvailable()).toBe(false);
    await expect(scanPairingQrCode()).rejects.toThrow('扫码仅在 iOS / Android App 内可用');
  });
});

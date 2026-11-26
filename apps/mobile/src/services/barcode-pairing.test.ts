// @vitest-environment happy-dom
import type { PairingLinkV3 } from '@piwin/contracts';
import { encodeBase64Url, encodePairingLinkV3 } from '@piwin/host-transport';
import { scan } from '@tauri-apps/plugin-barcode-scanner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyPairingInput,
  isNativeBarcodeAvailable,
  scanPairingQrCode,
} from './barcode-pairing.js';

vi.mock('@tauri-apps/plugin-barcode-scanner', () => ({
  Format: { QRCode: 'QR_CODE' },
  scan: vi.fn(),
  cancel: vi.fn(),
}));

const LINK: PairingLinkV3 = {
  v: 3,
  userId: 'AbCdEfGhIjKlMnOpQrSt_-',
  userName: 'Yorick',
  hostId: 'ZyXwVuTsRqPoNmLkJiHg-_',
  hostName: "Yorick's MacBook",
  hostKey: encodeBase64Url(new Uint8Array(32).fill(7)),
  relayUrl: 'wss://relay.example.com',
  directUrl: 'ws://192.168.1.20:8790',
  pairingToken: 'scan-me',
  role: 'member',
  expiresAt: 1_900_000_000_000,
};

describe('barcode pairing scanner', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it('does not call Tauri invoke outside a native runtime', async () => {
    expect(isNativeBarcodeAvailable()).toBe(false);
    await expect(scanPairingQrCode()).rejects.toThrow('扫码仅在 iOS / Android App 内可用');
  });

  it('classifies a v3 pairing link as a channel input', () => {
    const input = classifyPairingInput(encodePairingLinkV3(LINK));
    expect(input).toEqual({ kind: 'channel', link: LINK });
  });

  it('classifies legacy payloads as legacy inputs', () => {
    expect(classifyPairingInput('ws://192.168.1.50:8787')).toEqual({
      kind: 'legacy',
      data: { endpoint: 'ws://192.168.1.50:8787' },
    });
    const legacy = classifyPairingInput(
      'piwin://pair?endpoint=ws://192.168.1.50:8787&pairingToken=abc',
    );
    expect(legacy.kind).toBe('legacy');
    if (legacy.kind !== 'legacy') throw new Error('expected legacy input');
    expect(legacy.data.endpoint).toBe('ws://192.168.1.50:8787');
    expect(legacy.data.pairingToken).toBe('abc');
  });

  it('rejects an expired v3 link instead of treating it as legacy', () => {
    const expired = { ...LINK, expiresAt: 1 };
    expect(() => classifyPairingInput(encodePairingLinkV3(expired))).toThrow('已过期');
  });

  it('returns a channel input when the camera scans a v3 link', async () => {
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.mocked(scan).mockResolvedValue({ content: encodePairingLinkV3(LINK) } as Awaited<
      ReturnType<typeof scan>
    >);
    await expect(scanPairingQrCode()).resolves.toEqual({ kind: 'channel', link: LINK });
  });

  it('returns a legacy input when the camera scans a legacy QR', async () => {
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.mocked(scan).mockResolvedValue({ content: 'ws://192.168.1.50:8787' } as Awaited<
      ReturnType<typeof scan>
    >);
    await expect(scanPairingQrCode()).resolves.toEqual({
      kind: 'legacy',
      data: { endpoint: 'ws://192.168.1.50:8787' },
    });
  });

  it('rejects a scan with no content', async () => {
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.mocked(scan).mockResolvedValue({ content: '' } as Awaited<ReturnType<typeof scan>>);
    await expect(scanPairingQrCode()).rejects.toThrow('未检测到有效的二维码内容');
  });
});

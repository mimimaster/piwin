import { describe, expect, it } from 'vitest';
import { isNativeBarcodeAvailable, parsePairingString, scanPairingQrCode } from './barcode-pairing.js';

describe('Barcode Pairing String Parser', () => {
  it('parses raw WebSocket URL', () => {
    const parsed = parsePairingString('ws://192.168.1.100:8787');
    expect(parsed.endpoint).toBe('ws://192.168.1.100:8787');
    expect(parsed.authToken).toBeUndefined();
    expect(parsed.pairingToken).toBeUndefined();
  });

  it('treats legacy JSON token as a Host door password', () => {
    const json = JSON.stringify({
      endpoint: 'ws://100.116.146.89:8787',
      token: 'secret-token-123',
      name: 'MacBook Pro Host',
    });
    const parsed = parsePairingString(json);
    expect(parsed.endpoint).toBe('ws://100.116.146.89:8787');
    expect(parsed.authToken).toBe('secret-token-123');
    expect(parsed.pairingToken).toBeUndefined();
    expect(parsed.name).toBe('MacBook Pro Host');
  });

  it('parses v2 JSON pairing payload', () => {
    const json = JSON.stringify({
      v: 1,
      endpoint: 'wss://mac.ts.net:8787',
      pairingToken: 'one-time',
      hostInstanceId: 'host-1',
      protocolVersion: 1,
      expiresAt: Date.now() + 60_000,
    });
    const parsed = parsePairingString(json);
    expect(parsed).toMatchObject({
      endpoint: 'wss://mac.ts.net:8787',
      pairingToken: 'one-time',
      hostInstanceId: 'host-1',
    });
    expect(parsed.authToken).toBeUndefined();
  });

  it('parses a v2 piwin:// pairing URI', () => {
    const uri =
      'piwin://pair?endpoint=ws%3A%2F%2F127.0.0.1%3A8787&pairingToken=one-time&hostInstanceId=host-1';
    const parsed = parsePairingString(uri);
    expect(parsed.endpoint).toBe('ws://127.0.0.1:8787');
    expect(parsed.pairingToken).toBe('one-time');
    expect(parsed.authToken).toBeUndefined();
    expect(parsed.hostInstanceId).toBe('host-1');
  });

  it('treats a legacy piwin:// token as a door password', () => {
    const uri = 'piwin://pair?endpoint=ws%3A%2F%2F127.0.0.1%3A8787&token=my-token&name=LocalDev';
    const parsed = parsePairingString(uri);
    expect(parsed.endpoint).toBe('ws://127.0.0.1:8787');
    expect(parsed.authToken).toBe('my-token');
    expect(parsed.pairingToken).toBeUndefined();
    expect(parsed.name).toBe('LocalDev');
  });

  it('rejects expired pairing material', () => {
    const json = JSON.stringify({
      v: 1,
      endpoint: 'ws://127.0.0.1:8787',
      pairingToken: 'stale',
      expiresAt: 1,
    });
    expect(() => parsePairingString(json)).toThrow('配对码已过期');
  });

  it('throws on invalid non-URL string', () => {
    expect(() => parsePairingString('hello world')).toThrowError('二维码格式无法识别');
  });

  it('does not call Tauri invoke outside a native runtime', async () => {
    expect(isNativeBarcodeAvailable()).toBe(false);
    await expect(scanPairingQrCode()).rejects.toThrow('扫码仅在 iOS / Android App 内可用');
  });
});

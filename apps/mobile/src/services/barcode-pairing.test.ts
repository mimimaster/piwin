import { describe, expect, it } from 'vitest';
import { parsePairingString } from './barcode-pairing.js';

describe('Barcode Pairing String Parser', () => {
  it('parses raw WebSocket URL', () => {
    const parsed = parsePairingString('ws://192.168.1.100:8787');
    expect(parsed.endpoint).toBe('ws://192.168.1.100:8787');
    expect(parsed.token).toBeUndefined();
  });

  it('parses JSON formatted pairing payload', () => {
    const json = JSON.stringify({
      endpoint: 'ws://100.116.146.89:8787',
      token: 'secret-token-123',
      name: 'MacBook Pro Host',
    });
    const parsed = parsePairingString(json);
    expect(parsed.endpoint).toBe('ws://100.116.146.89:8787');
    expect(parsed.token).toBe('secret-token-123');
    expect(parsed.name).toBe('MacBook Pro Host');
  });

  it('parses piwin:// URI scheme', () => {
    const uri = 'piwin://pair?endpoint=ws%3A%2F%2F127.0.0.1%3A8787&token=my-token&name=LocalDev';
    const parsed = parsePairingString(uri);
    expect(parsed.endpoint).toBe('ws://127.0.0.1:8787');
    expect(parsed.token).toBe('my-token');
    expect(parsed.name).toBe('LocalDev');
  });

  it('throws on invalid non-URL string', () => {
    expect(() => parsePairingString('hello world')).toThrowError('二维码格式无法识别');
  });
});

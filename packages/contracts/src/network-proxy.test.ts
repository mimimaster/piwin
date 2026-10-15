import { describe, expect, it } from 'vitest';
import {
  normalizeNetworkConfig,
  parseNetworkProxySetting,
  validateNetworkConfig,
} from './network-proxy.js';

describe('parseNetworkProxySetting', () => {
  it('reads inherit, direct and proxy values', () => {
    expect(parseNetworkProxySetting(undefined)).toEqual({ mode: 'inherit' });
    expect(parseNetworkProxySetting('  ')).toEqual({ mode: 'inherit' });
    expect(parseNetworkProxySetting('Direct')).toEqual({ mode: 'direct' });
    expect(parseNetworkProxySetting('none')).toEqual({ mode: 'direct' });
    expect(parseNetworkProxySetting(' http://127.0.0.1:7897 ')).toEqual({
      mode: 'proxy',
      url: 'http://127.0.0.1:7897',
    });
    expect(parseNetworkProxySetting('https://user:pw@proxy.corp:443').mode).toBe('proxy');
  });

  it('rejects SOCKS, PAC and malformed values', () => {
    expect(parseNetworkProxySetting('socks5://127.0.0.1:1080').mode).toBe('invalid');
    expect(parseNetworkProxySetting('127.0.0.1:7897').mode).toBe('invalid');
    expect(parseNetworkProxySetting('not a url').mode).toBe('invalid');
  });
});

describe('network config', () => {
  it('normalizes to a trimmed value and drops empty settings', () => {
    expect(normalizeNetworkConfig({ proxyUrl: ' direct ' })).toEqual({ proxyUrl: 'direct' });
    expect(normalizeNetworkConfig({ proxyUrl: '' })).toBeUndefined();
    expect(normalizeNetworkConfig('http://x')).toBeUndefined();
  });

  it('keeps an invalid value for validation to block instead of dropping it', () => {
    const config = normalizeNetworkConfig({ proxyUrl: 'socks5://127.0.0.1:1080' });
    expect(config).toEqual({ proxyUrl: 'socks5://127.0.0.1:1080' });
    expect(validateNetworkConfig(config)).toEqual([
      { path: 'network.proxyUrl', message: expect.stringContaining('SOCKS') as unknown as string },
    ]);
    expect(validateNetworkConfig(undefined)).toEqual([]);
  });
});

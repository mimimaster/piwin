import { describe, expect, it } from 'vitest';
import {
  parseScutilProxy,
  parseWindowsProxyQuery,
  parseWindowsProxyServer,
} from './system-proxy-fetch.js';

describe('system proxy parsing', () => {
  it('returns nothing when the macOS proxies are off', () => {
    expect(
      parseScutilProxy(`
        HTTPEnable : 0
        HTTPSEnable : 0
        HTTPProxy : 127.0.0.1
        HTTPPort : 7890
      `),
    ).toBeUndefined();
  });

  it('reads the enabled macOS HTTPS proxy without assuming a port', () => {
    expect(
      parseScutilProxy(`
        HTTPEnable : 1
        HTTPProxy : 127.0.0.1
        HTTPPort : 7890
        HTTPSEnable : 1
        HTTPSProxy : 127.0.0.1
        HTTPSPort : 7897
      `),
    ).toEqual({ protocol: 'http:', hostname: '127.0.0.1', port: 7897 });
  });

  it('ignores a Windows proxy server while ProxyEnable is off', () => {
    expect(
      parseWindowsProxyQuery(`
        ProxyEnable    REG_DWORD    0x0
        ProxyServer    REG_SZ    127.0.0.1:7890
      `),
    ).toBeUndefined();
  });

  it('parses an enabled Windows per-protocol proxy server', () => {
    expect(
      parseWindowsProxyQuery(`
        ProxyEnable    REG_DWORD    0x1
        ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7891
      `),
    ).toEqual({ protocol: 'http:', hostname: '127.0.0.1', port: 7891 });
  });

  it('ignores an empty Windows proxy value', () => {
    expect(parseWindowsProxyServer('-')).toBeUndefined();
  });
});

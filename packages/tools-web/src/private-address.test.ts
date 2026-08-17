import { describe, expect, it } from 'vitest';
import { isPrivateOrLocalHostname, isPrivateOrLocalIpAddress } from './private-address.js';

describe('isPrivateOrLocalIpAddress', () => {
  it('flags loopback and RFC1918', () => {
    expect(isPrivateOrLocalIpAddress('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIpAddress('10.1.2.3')).toBe(true);
    expect(isPrivateOrLocalIpAddress('192.168.1.1')).toBe(true);
    expect(isPrivateOrLocalIpAddress('172.16.0.1')).toBe(true);
    expect(isPrivateOrLocalIpAddress('169.254.169.254')).toBe(true);
    expect(isPrivateOrLocalIpAddress('8.8.8.8')).toBe(false);
  });

  it('flags ipv6 loopback and ula', () => {
    expect(isPrivateOrLocalIpAddress('::1')).toBe(true);
    expect(isPrivateOrLocalIpAddress('fd12::1')).toBe(true);
  });

  it('flags IPv4-mapped IPv6 in both dotted and hex forms', () => {
    expect(isPrivateOrLocalIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIpAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateOrLocalIpAddress('::ffff:a9fe:a9fe')).toBe(true);
    expect(isPrivateOrLocalIpAddress('0:0:0:0:0:ffff:c0a8:1')).toBe(true);
    expect(isPrivateOrLocalIpAddress('::ffff:808:808')).toBe(false);
  });
});

describe('isPrivateOrLocalHostname', () => {
  it('flags localhost and .local', () => {
    expect(isPrivateOrLocalHostname('localhost')).toBe(true);
    expect(isPrivateOrLocalHostname('printer.local')).toBe(true);
    expect(isPrivateOrLocalHostname('example.com')).toBe(false);
  });
});

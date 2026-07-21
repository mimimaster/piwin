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
});

describe('isPrivateOrLocalHostname', () => {
  it('flags localhost and .local', () => {
    expect(isPrivateOrLocalHostname('localhost')).toBe(true);
    expect(isPrivateOrLocalHostname('printer.local')).toBe(true);
    expect(isPrivateOrLocalHostname('example.com')).toBe(false);
  });
});

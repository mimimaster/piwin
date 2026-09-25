import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { listMobileAccessEndpointCandidates } from './mobile-access-endpoints.js';

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  };
}

describe('listMobileAccessEndpointCandidates', () => {
  it('orders Wi-Fi first, then other LAN, bridges, and Tailscale last', () => {
    const candidates = listMobileAccessEndpointCandidates(8790, {
      lo0: [ipv4('127.0.0.1', true)],
      utun4: [ipv4('100.101.102.103')],
      bridge100: [ipv4('192.168.64.1')],
      en7: [ipv4('10.0.0.8')],
      en0: [ipv4('192.168.1.5'), ipv4('169.254.10.10')],
      vpn0: [ipv4('172.20.0.4')],
    });
    expect(candidates).toEqual([
      { url: 'ws://192.168.1.5:8790', kind: 'lan', interfaceName: 'en0' },
      { url: 'ws://10.0.0.8:8790', kind: 'lan', interfaceName: 'en7' },
      { url: 'ws://172.20.0.4:8790', kind: 'lan', interfaceName: 'vpn0' },
      { url: 'ws://192.168.64.1:8790', kind: 'lan', interfaceName: 'bridge100' },
      { url: 'ws://100.101.102.103:8790', kind: 'tailscale', interfaceName: 'utun4' },
    ]);
  });

  it('never offers public, loopback, link-local or IPv6 addresses', () => {
    expect(
      listMobileAccessEndpointCandidates(8787, {
        en0: [
          ipv4('203.0.113.9'),
          ipv4('169.254.1.1'),
          { ...ipv4('fe80::1'), family: 'IPv6', scopeid: 4 } as NetworkInterfaceInfo,
        ],
        lo0: [ipv4('127.0.0.1', true)],
      }),
    ).toEqual([]);
  });
});

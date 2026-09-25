import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { MobileAccessEndpointCandidate } from '@piwin/contracts';

export type NetworkInterfaceTable = Record<string, NetworkInterfaceInfo[] | undefined>;

/**
 * Addresses a phone could dial to reach a wildcard-bound listener.
 *
 * Order is the default pick: physical Wi-Fi/Ethernet (`en*`) first because
 * "scan the QR on the same Wi-Fi" is the common case, then other private
 * LAN interfaces, then Tailscale (CGNAT 100.64/10), which only works when
 * the phone is on the same tailnet. Public addresses are never offered.
 * IPv6 is skipped: a scoped link-local or rotating temporary address makes a
 * poor long-lived pairing endpoint.
 */
export function listMobileAccessEndpointCandidates(
  port: number,
  interfaces: NetworkInterfaceTable = networkInterfaces(),
): MobileAccessEndpointCandidate[] {
  const candidates: Array<MobileAccessEndpointCandidate & { rank: number }> = [];
  const seen = new Set<string>();
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || isLinkLocalIpv4(entry.address)) {
        continue;
      }
      if (seen.has(entry.address)) {
        continue;
      }
      seen.add(entry.address);
      const kind = isTailscaleIpv4(entry.address) ? 'tailscale' : 'lan';
      // Never suggest a public address: the listener speaks cleartext ws://.
      if (kind === 'lan' && !isPrivateIpv4(entry.address)) {
        continue;
      }
      candidates.push({
        url: `ws://${entry.address}:${port}`,
        kind,
        interfaceName,
        rank: rankCandidate(kind, interfaceName),
      });
    }
  }
  return candidates
    .sort((left, right) => left.rank - right.rank || left.interfaceName.localeCompare(right.interfaceName))
    .map(({ url, kind, interfaceName }) => ({ url, kind, interfaceName }));
}

function rankCandidate(kind: 'lan' | 'tailscale', interfaceName: string): number {
  if (kind === 'tailscale') {
    return 3;
  }
  if (/^en\d+$/.test(interfaceName)) {
    return 0;
  }
  // Docker/VM bridges (bridge*, vmnet*, docker*) are private but rarely phone-reachable.
  if (/^(bridge|vmnet|vboxnet|docker|br-|veth)/.test(interfaceName)) {
    return 2;
  }
  return 1;
}

function parseIpv4(address: string): [number, number, number, number] | undefined {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

function isLinkLocalIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  return octets !== undefined && octets[0] === 169 && octets[1] === 254;
}

function isTailscaleIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  return octets !== undefined && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (octets === undefined) {
    return false;
  }
  const [first, second] = octets;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

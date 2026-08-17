/**
 * Detect private / link-local / loopback / metadata addresses for SSRF defense.
 * Pure string checks — DNS resolution is handled separately at fetch time.
 */

/** Extract the IPv4 address from an IPv4-mapped IPv6 form, if present. */
export function mappedIpv4FromIpv6(address: string): string | undefined {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const dotted = value.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted?.[1]) {
    return dotted[1];
  }
  const hex = value.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  const highPart = hex?.[1];
  const lowPart = hex?.[2];
  if (highPart === undefined || lowPart === undefined) {
    return undefined;
  }
  const high = Number.parseInt(highPart, 16);
  const low = Number.parseInt(lowPart, 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || low < 0) {
    return undefined;
  }
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }
  return isPrivateOrLocalIpAddress(host);
}

export function isPrivateOrLocalIpAddress(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return true;

  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split('.').map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 (simplified)
  if (value.includes(':')) {
    if (value === '::1' || value === '::') return true;
    if (value.startsWith('fc') || value.startsWith('fd')) return true; // ULA
    if (value.startsWith('fe80')) return true; // link-local
    const mapped = mappedIpv4FromIpv6(value);
    if (mapped) {
      return isPrivateOrLocalIpAddress(mapped);
    }
    if (value === '0:0:0:0:0:0:0:1') return true;
    return false;
  }

  return false;
}

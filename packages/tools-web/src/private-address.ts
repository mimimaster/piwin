/**
 * Detect private / link-local / loopback / metadata addresses for SSRF defense.
 * Pure string checks — DNS resolution is handled separately at fetch time.
 */

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
    const mapped = value.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mapped?.[1]) {
      return isPrivateOrLocalIpAddress(mapped[1]);
    }
    if (value === '0:0:0:0:0:0:0:1') return true;
    return false;
  }

  return false;
}

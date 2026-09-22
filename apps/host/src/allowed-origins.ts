/**
 * Browser Origin allowlist for a deployed Web shell.
 *
 * Absent or empty means the Host default: loopback and `tauri://localhost`
 * only. A comma-separated list admits those exact Origins (scheme + host +
 * port, no path). `*` admits any browser Origin and is only for a private
 * network the operator already trusts.
 */

const MAX_ORIGIN_ENTRIES = 32;
const MAX_ORIGIN_LENGTH = 256;

export function parseHostAllowedOrigins(
  raw: string | undefined,
): readonly string[] | undefined {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed === '*') {
    return ['*'];
  }
  const origins = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (origins.length === 0 || origins.length > MAX_ORIGIN_ENTRIES) {
    throw new Error(
      'PIWIN_HOST_ALLOWED_ORIGINS must list 1–32 Origins, or be *',
    );
  }
  for (const origin of origins) {
    if (origin.length > MAX_ORIGIN_LENGTH || !isOrigin(origin)) {
      throw new Error(
        `PIWIN_HOST_ALLOWED_ORIGINS entry is not an Origin: ${origin}`,
      );
    }
  }
  return origins;
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === '/' &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

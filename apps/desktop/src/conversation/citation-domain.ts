/** Hostname + favicon initials for proto-01 `.cite .fav`. */

export function citeDomainLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || url;
  } catch {
    return url;
  }
}

const FAV_ALIASES: Readonly<Record<string, string>> = {
  github: 'GH',
  claude: 'CL',
  anthropic: 'AN',
  zed: 'Z',
};

/**
 * Fav monogram from hostname. Prefer the registrable label
 * (docs.claude.com → CL, github.com → GH); short names stay one letter (zed → Z).
 */
export function citeFavInitials(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  const label =
    parts.length >= 2 ? (parts[parts.length - 2] ?? parts[0] ?? '') : (parts[0] ?? '');
  const cleaned = label.replace(/[^a-z0-9]/g, '');
  if (cleaned.length === 0) return '?';
  const alias = FAV_ALIASES[cleaned];
  if (alias) return alias;
  if (cleaned.length <= 3) return cleaned.slice(0, 1).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

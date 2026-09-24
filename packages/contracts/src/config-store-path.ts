/**
 * Map a path a chip or tool reported onto the Host config store.
 *
 * A path counts only when it lies under *this* Host's config root. The root
 * and the path may each be written home-relative (`~/.piwin`) or expanded
 * (`/Users/me/.piwin`); both forms name the same file. Any other store
 * directory — the production `~/.piwin` seen from a test Host rooted at
 * `~/.piwin-test`, or a backup copy — is a different file and must not be
 * read from this root under the requested name.
 *
 * The media vault is not config text (it previews through the media channel),
 * and the root itself is not a file, so both answer null.
 */

/** A home directory as it appears in an expanded path when the Host's is unknown. */
const HOME_PREFIX_PATTERN = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\/Users\/[^/]+)(?=\/|$)/i;

function normalizePathText(value: string): string {
  return value
    .replace(/^file:\/\//i, '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

/**
 * The part of `path` under the user's home, or null when it is not a home path.
 * `homeDir` is authoritative when the caller knows it (the Host); otherwise a
 * conventional home prefix is recognised (Desktop talking to a remote Host).
 */
function homeRelative(path: string, homeDir: string | undefined): string | null {
  if (path === '~') return '';
  if (path.startsWith('~/')) return path.slice(2);
  const home = homeDir ? normalizePathText(homeDir) : null;
  if (home) {
    if (path.toLowerCase() === home.toLowerCase()) return '';
    return path.toLowerCase().startsWith(`${home.toLowerCase()}/`) ? path.slice(home.length + 1) : null;
  }
  const match = path.match(HOME_PREFIX_PATTERN);
  if (!match) return null;
  return path.slice(match[0].length).replace(/^\//, '');
}

function relativeUnder(root: string, path: string): string | null {
  // Case-insensitive for Windows and default macOS volumes; keep path casing.
  if (path.toLowerCase() === root.toLowerCase()) return '';
  return path.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? path.slice(root.length + 1) : null;
}

export function configStoreRelativePath(
  filePath: string,
  configRoot: string | null | undefined,
  homeDir?: string,
): string | null {
  const root = normalizePathText(configRoot ?? '');
  const path = normalizePathText(filePath);
  if (!root || !path) return null;

  let relative = relativeUnder(root, path);
  if (relative === null) {
    const rootInHome = homeRelative(root, homeDir);
    const pathInHome = homeRelative(path, homeDir);
    if (rootInHome && pathInHome !== null) {
      relative = relativeUnder(rootInHome, pathInHome);
    }
  }

  if (!relative) return null;
  const segments = relative.split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) return null;
  if (segments[0]?.toLowerCase() === 'media') return null;
  return relative;
}

/**
 * How to show a config-store file: `~/<store>/<relative>`, naming the store the
 * Host actually uses (`.piwin-test` on a test Host), never a hard-coded one.
 * Path-free apart from the store name, so it is safe for remote projection.
 */
export function configStoreDisplayRef(configRoot: string | null | undefined, relativePath: string): string {
  const store = normalizePathText(configRoot ?? '').split('/').pop() || '.piwin';
  const relative = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return relative ? `~/${store}/${relative}` : `~/${store}`;
}

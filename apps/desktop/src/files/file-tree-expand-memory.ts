/**
 * Persist file-tree expand state per project in localStorage.
 *
 * Storage shape: `{ [projectPath]: string[] }` under a single key. Each
 * project's expanded-relative-path list is capped at 200 entries to bound
 * storage growth. All access is wrapped in try/catch so a missing or blocked
 * localStorage (private mode, SSR) degrades to empty / no-op rather than
 * throwing into the UI.
 */
export const STORAGE_KEY = 'piwin.fileTree.expanded.v1';

/** Maximum number of expanded paths persisted per project. */
const MAX_PATHS = 200;

type ExpandedStore = Record<string, string[]>;

/** Read the raw store; malformed JSON or unavailable storage → empty object. */
function readStore(): ExpandedStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ExpandedStore;
    }
    return {};
  } catch {
    return {};
  }
}

/** Write the raw store; unavailable storage → silent no-op. */
function writeStore(store: ExpandedStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked: drop silently — expand state is best-effort.
  }
}

/**
 * Load the set of expanded relative paths remembered for `projectPath`.
 * Returns an empty Set when the project has no saved state, the stored JSON
 * is malformed, or localStorage is unavailable.
 */
export function loadExpandedPaths(projectPath: string): Set<string> {
  const store = readStore();
  const list = store[projectPath];
  if (!Array.isArray(list)) return new Set();
  return new Set(list);
}

/**
 * Persist the expanded relative paths for `projectPath`. Merges into the
 * existing store (other projects are preserved) and caps this project's list
 * at the last {@link MAX_PATHS} entries to bound storage. No-op when
 * localStorage is unavailable.
 */
export function saveExpandedPaths(projectPath: string, paths: Iterable<string>): void {
  const store = readStore();
  const all = Array.from(paths);
  // Keep the last MAX_PATHS entries (most recently appended win retention).
  const capped = all.length > MAX_PATHS ? all.slice(all.length - MAX_PATHS) : all;
  store[projectPath] = capped;
  writeStore(store);
}

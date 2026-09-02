/**
 * Bounded workspace file/folder index for `@` mentions.
 *
 * Walks the project tree breadth-first through an injected `listDirectory`
 * (Host `project/list-dir`), so the UI never touches `fs`. Caps depth, visited
 * directories and total entries: the composer catalog must stay cheap to build
 * and cheap to filter on every keystroke.
 */

export type AtWorkspaceEntry = {
  /** Posix relative path from project root, no leading slash. */
  relativePath: string;
  kind: 'file' | 'directory';
};

export const AT_FILE_INDEX_MAX_ENTRIES = 1200;
export const AT_FILE_INDEX_MAX_DIRECTORIES = 150;
export const AT_FILE_INDEX_MAX_DEPTH = 6;

export type AtFileIndexListDirectory = (
  relativePath: string,
) => Promise<ReadonlyArray<{ relativePath: string; kind: 'file' | 'directory' }>>;

export type CollectWorkspaceFileIndexOptions = {
  maxEntries?: number;
  maxDirectories?: number;
  maxDepth?: number;
  /** Cooperative cancellation for a project switch mid-walk. */
  isCancelled?: () => boolean;
};

/**
 * Breadth-first so shallow, high-signal paths (`src/App.tsx`, `package.json`)
 * are indexed before deep subtrees when the entry cap is hit.
 */
export async function collectWorkspaceFileIndex(
  listDirectory: AtFileIndexListDirectory,
  options: CollectWorkspaceFileIndexOptions = {},
): Promise<AtWorkspaceEntry[]> {
  const maxEntries = options.maxEntries ?? AT_FILE_INDEX_MAX_ENTRIES;
  const maxDirectories = options.maxDirectories ?? AT_FILE_INDEX_MAX_DIRECTORIES;
  const maxDepth = options.maxDepth ?? AT_FILE_INDEX_MAX_DEPTH;
  const isCancelled = options.isCancelled ?? (() => false);

  const entries: AtWorkspaceEntry[] = [];
  const seen = new Set<string>();
  const queue: Array<{ relativePath: string; depth: number }> = [{ relativePath: '', depth: 0 }];
  let visitedDirectories = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (isCancelled() || entries.length >= maxEntries || visitedDirectories >= maxDirectories) {
      break;
    }
    visitedDirectories += 1;

    let listed: ReadonlyArray<{ relativePath: string; kind: 'file' | 'directory' }>;
    try {
      listed = await listDirectory(current.relativePath);
    } catch {
      // A single unreadable directory must not abort the whole index.
      continue;
    }

    for (const entry of listed) {
      const relativePath = normalizeIndexPath(entry.relativePath);
      if (relativePath.length === 0 || seen.has(relativePath)) continue;
      seen.add(relativePath);
      if (entries.length < maxEntries) {
        entries.push({ relativePath, kind: entry.kind });
      }
      if (entry.kind === 'directory' && current.depth + 1 < maxDepth) {
        queue.push({ relativePath, depth: current.depth + 1 });
      }
    }
  }

  return entries;
}

function normalizeIndexPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

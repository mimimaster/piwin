/**
 * When to offer "Show in Finder / file manager".
 *
 * Policy A: enable for local disks; on remote Host only when the resolved
 * absolute path is present on this Desktop machine (same-machine loopback /
 * shared disk). Never pretend a cross-machine Host path opens in local Finder.
 */
import { looksLikeFilesystemWorkspacePath } from './workspace-open.js';

export type LocalRootPresence = 'unknown' | 'present' | 'absent';

const localPresenceByRoot = new Map<string, LocalRootPresence>();

function normalizeRoot(path: string): string {
  return path.trim().replace(/[\\/]+$/, '');
}

export function rememberLocalRootPresence(rootPath: string, presence: LocalRootPresence): void {
  const root = normalizeRoot(rootPath);
  if (!looksLikeFilesystemWorkspacePath(root)) {
    return;
  }
  localPresenceByRoot.set(root, presence);
}

export function localRootPresence(rootPath: string): LocalRootPresence | null {
  const root = normalizeRoot(rootPath);
  return localPresenceByRoot.get(root) ?? null;
}

/** Longest remembered root that is a prefix of `absolutePath`, if any. */
export function rememberedRootForAbsolutePath(absolutePath: string): string | null {
  const path = normalizeRoot(absolutePath);
  if (!looksLikeFilesystemWorkspacePath(path)) {
    return null;
  }
  let best: string | null = null;
  for (const root of localPresenceByRoot.keys()) {
    if (path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
      if (best === null || root.length > best.length) {
        best = root;
      }
    }
  }
  return best;
}

/**
 * Sync menu gate. Remote Host roots stay off until a Desktop-local exists probe
 * marks them `present`.
 */
export function canRevealInLocalFileManager(absolutePath: string): boolean {
  if (!looksLikeFilesystemWorkspacePath(absolutePath)) {
    return false;
  }
  const root = rememberedRootForAbsolutePath(absolutePath);
  if (root === null) {
    // Not associated with a probed remote root — treat as local sidecar path.
    return true;
  }
  return localPresenceByRoot.get(root) === 'present';
}

export function revealDisabledHint(locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN'
    ? '文件在远程 Host 上，请复制完整路径'
    : 'file is on the remote Host — copy absolute path';
}

/** Test seam. */
export function clearLocalRootPresenceForTests(): void {
  localPresenceByRoot.clear();
}

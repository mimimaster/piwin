/**
 * Desktop helpers for PathChip file actions: resolve, save-as, reveal folder.
 *
 * Save As prefers a direct byte read (asset protocol / File System Access).
 * Workspace files outside the Tauri asset scope fall back to: copy absolute
 * path + open the parent folder so the user can drag/copy manually.
 * Reveal uses plugin-shell `open` on the parent folder (macOS + Windows).
 */

export function fileNameFromLocalPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).pop() || trimmed || 'file';
}

export function parentDirectoryOf(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) {
    return normalized.startsWith('/') ? '/' : '.';
  }
  // Windows drive root: C:/file → C:/
  if (/^[A-Za-z]:$/.test(normalized.slice(0, idx))) {
    return `${normalized.slice(0, idx)}/`;
  }
  return normalized.slice(0, idx) || '/';
}

/**
 * Resolve a chip path to an absolute filesystem path when possible.
 * Relative paths join `projectPath` when provided.
 */
export function resolveLocalFileAbsolutePath(
  path: string,
  projectPath?: string | null,
): string {
  const clean = path.replace(/^file:\/\//i, '').trim();
  if (!clean) {
    return clean;
  }
  if (clean.startsWith('/') || /^[A-Za-z]:[\\/]/.test(clean)) {
    return clean;
  }
  if (clean.startsWith('~/')) {
    return clean; // expand is Host-side; chip still copies the literal
  }
  const root = (projectPath ?? '').trim().replace(/[\\/]+$/, '');
  if (!root) {
    return clean;
  }
  const relative = clean.replace(/^\.\//, '');
  return `${root}/${relative}`.replace(/\\/g, '/');
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

async function tryReadLocalFileBlob(absolutePath: string): Promise<Blob | null> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    if (typeof convertFileSrc !== 'function') {
      return null;
    }
    const assetUrl = convertFileSrc(absolutePath);
    const response = await fetch(assetUrl);
    if (!response.ok) {
      return null;
    }
    return response.blob();
  } catch {
    return null;
  }
}

export type SaveLocalFileAsResult =
  | { kind: 'downloaded' }
  | { kind: 'cancelled' }
  | { kind: 'revealed-fallback' }
  | { kind: 'failed' };

/**
 * Offer the file to the user as a download. When the webview cannot read the
 * path (outside asset-protocol scope), fall back to reveal + clipboard.
 */
export async function saveLocalFileAs(absolutePath: string): Promise<SaveLocalFileAsResult> {
  const fileName = fileNameFromLocalPath(absolutePath);
  const blob = await tryReadLocalFileBlob(absolutePath);

  if (blob) {
    const picker = (
      globalThis as unknown as {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }
    ).showSaveFilePicker;

    if (typeof picker === 'function') {
      try {
        const handle = await picker({ suggestedName: fileName });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { kind: 'downloaded' };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return { kind: 'cancelled' };
        }
      }
    }

    triggerBlobDownload(blob, fileName);
    return { kind: 'downloaded' };
  }

  // Workspace / Host paths are outside the asset-protocol allowlist. Copy the
  // absolute path and open the folder so the user can take the file manually.
  try {
    await navigator.clipboard.writeText(absolutePath);
  } catch {
    // ignore clipboard failures; still try reveal
  }
  const revealed = await revealLocalFileInFolder(absolutePath);
  return revealed ? { kind: 'revealed-fallback' } : { kind: 'failed' };
}

/**
 * Open the file's parent folder in the OS file manager (Finder / Explorer).
 * Selecting the file itself needs shell execute scopes we do not enable yet;
 * opening the folder is the portable subset.
 */
export async function revealLocalFileInFolder(absolutePath: string): Promise<boolean> {
  const folder = parentDirectoryOf(absolutePath);
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(folder);
    return true;
  } catch {
    return false;
  }
}

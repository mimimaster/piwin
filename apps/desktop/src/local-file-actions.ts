/**
 * Desktop helpers for PathChip file actions: resolve, save-as, reveal folder.
 *
 * Save As prefers asset-protocol fetch, then Host `preview/export-local-file`
 * for workspace paths outside the Tauri asset scope. Last resort: copy path +
 * open the parent folder. Reveal uses a desktop `open -R` command (Finder /
 * Explorer); plugin-shell `open` cannot be used because its default scope is
 * http(s)/mailto/tel only.
 */

import { rememberLocalRootPresence } from './local-file-reveal-policy.js';
import { resolveProjectFilesystemRoot } from './remote-session-hydrate.js';
import { isTauriRuntime } from './tauri-pty.js';
import { looksLikeFilesystemWorkspacePath } from './workspace-open.js';

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
 * Relative paths join `projectPath` when provided. Opaque remote project ids
 * are expanded via the remembered Host root from `project/list`.
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
  const root = resolveProjectFilesystemRoot(projectPath);
  if (!root) {
    return clean;
  }
  const relative = clean.replace(/^\.\//, '');
  return `${root}/${relative}`.replace(/\\/g, '/');
}

export type ExportedLocalFileBytes = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

/** Optional Host-backed reader for paths outside the Tauri asset scope. */
export type LocalFileBytesReader = (
  absolutePath: string,
) => Promise<ExportedLocalFileBytes | null>;

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

function bytesToBlob(exported: ExportedLocalFileBytes): Blob {
  const copy = new Uint8Array(exported.bytes.byteLength);
  copy.set(exported.bytes);
  return new Blob([copy.buffer], { type: exported.mimeType || 'application/octet-stream' });
}

async function offerBlobDownload(blob: Blob, fileName: string): Promise<'downloaded' | 'cancelled'> {
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
      return 'downloaded';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  triggerBlobDownload(blob, fileName);
  return 'downloaded';
}

export type SaveLocalFileAsResult =
  | { kind: 'downloaded' }
  | { kind: 'cancelled' }
  | { kind: 'revealed-fallback' }
  | { kind: 'failed' };

export type SaveLocalFileAsOptions = {
  /** Host `preview/export-local-file` (or test double). */
  readBytes?: LocalFileBytesReader;
};

/**
 * Offer the file to the user as a download.
 * Order: asset protocol → Host export → reveal + clipboard fallback.
 */
export async function saveLocalFileAs(
  absolutePath: string,
  options?: SaveLocalFileAsOptions,
): Promise<SaveLocalFileAsResult> {
  const fileName = fileNameFromLocalPath(absolutePath);

  const assetBlob = await tryReadLocalFileBlob(absolutePath);
  if (assetBlob) {
    const offered = await offerBlobDownload(assetBlob, fileName);
    return { kind: offered };
  }

  if (options?.readBytes) {
    try {
      const exported = await options.readBytes(absolutePath);
      if (exported) {
        const offered = await offerBlobDownload(
          bytesToBlob(exported),
          exported.fileName || fileName,
        );
        return { kind: offered };
      }
    } catch {
      // Fall through to reveal fallback.
    }
  }

  try {
    await navigator.clipboard.writeText(absolutePath);
  } catch {
    // ignore clipboard failures; still try reveal
  }
  const revealed = await revealLocalFileInFolder(absolutePath);
  return revealed.ok ? { kind: 'revealed-fallback' } : { kind: 'failed' };
}

export type RevealLocalFileResult =
  | { ok: true }
  | { ok: false; reason: 'not-desktop' | 'failed' | 'not-local' };

/**
 * Probe whether a Host filesystem root exists on this Desktop machine.
 * Used so remote Reveal is only offered for same-machine / shared-disk roots.
 */
export async function probeLocalFilesystemRoot(rootPath: string): Promise<boolean> {
  const root = rootPath.trim().replace(/[\\/]+$/, '');
  if (!looksLikeFilesystemWorkspacePath(root)) {
    rememberLocalRootPresence(root, 'absent');
    return false;
  }
  rememberLocalRootPresence(root, 'unknown');
  if (!isTauriRuntime()) {
    rememberLocalRootPresence(root, 'absent');
    return false;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const exists = await invoke<boolean>('path_exists_locally', { path: root });
    rememberLocalRootPresence(root, exists ? 'present' : 'absent');
    return exists;
  } catch {
    rememberLocalRootPresence(root, 'absent');
    return false;
  }
}

/**
 * Reveal the file in the OS file manager (Finder selects the file on macOS).
 * Browser / mock preview has no desktop shell, so this returns `not-desktop`.
 */
export async function revealLocalFileInFolder(
  absolutePath: string,
): Promise<RevealLocalFileResult> {
  if (!isTauriRuntime()) {
    return { ok: false, reason: 'not-desktop' };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const exists = await invoke<boolean>('path_exists_locally', { path: absolutePath });
    if (!exists) {
      const parent = parentDirectoryOf(absolutePath);
      const parentExists =
        parent !== absolutePath
          ? await invoke<boolean>('path_exists_locally', { path: parent })
          : false;
      if (!parentExists) {
        return { ok: false, reason: 'not-local' };
      }
    }
    await invoke('reveal_in_file_manager', { path: absolutePath });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

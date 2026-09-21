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

function extensionFilterFor(fileName: string): { name: string; extensions: string[] }[] | undefined {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) {
    return undefined;
  }
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) {
    return undefined;
  }
  return [{ name: ext.toUpperCase(), extensions: [ext] }];
}

/**
 * Native Save As path on Desktop. `null` = user cancelled.
 * Throws when the dialog plugin is missing. Browser callers must not use this.
 */
export async function chooseSaveAsPath(fileName: string): Promise<string | null> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  if (typeof dialog.save !== 'function') {
    throw new Error('save dialog unavailable');
  }
  const filters = extensionFilterFor(fileName);
  const selected = await dialog.save({
    title: 'Save As',
    defaultPath: fileName,
    ...(filters ? { filters } : {}),
  });
  return selected;
}

async function copyLocalFileToPath(source: string, destination: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('copy_local_file', { source, destination });
    return true;
  } catch {
    return false;
  }
}

async function writeBlobToPath(destination: string, blob: Blob): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await invoke('write_saved_file', { path: destination, contents: Array.from(bytes) });
    return true;
  } catch {
    return false;
  }
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

export async function saveBlobAs(
  blob: Blob,
  fileName: string,
): Promise<SaveLocalFileAsResult> {
  if (!isTauriRuntime()) {
    return offerBrowserSave(blob, fileName);
  }
  try {
    const dest = await chooseSaveAsPath(fileName);
    if (dest === null) {
      return { kind: 'cancelled' };
    }
    const written = await writeBlobToPath(dest, blob);
    return { kind: written ? 'saved' : 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function saveMediaUrlAs(
  srcUrl: string,
  fileName: string,
): Promise<SaveLocalFileAsResult> {
  try {
    const response = await fetch(srcUrl);
    if (!response.ok) {
      return { kind: 'failed' };
    }
    return saveBlobAs(await response.blob(), fileName);
  } catch {
    return { kind: 'failed' };
  }
}

async function offerBrowserSave(
  blob: Blob,
  fileName: string,
): Promise<SaveLocalFileAsResult> {
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
      return { kind: 'saved' };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { kind: 'cancelled' };
      }
    }
  }

  triggerBlobDownload(blob, fileName);
  return { kind: 'downloaded' };
}

export type SaveLocalFileAsResult =
  | { kind: 'saved' }
  | { kind: 'downloaded' }
  | { kind: 'cancelled' }
  | { kind: 'revealed-fallback' }
  | { kind: 'failed' };

/** User-facing copy for a finished Save As. `null` = stay silent (cancel). */
export function saveAsResultNotice(
  result: SaveLocalFileAsResult,
  locale: 'zh-CN' | 'en',
): { message: string; level: 'success' | 'info' | 'error' } | null {
  switch (result.kind) {
    case 'saved':
      return {
        message: locale === 'zh-CN' ? '已保存' : 'Saved',
        level: 'success',
      };
    case 'downloaded':
      return {
        message: locale === 'zh-CN' ? '已保存到下载文件夹' : 'Saved to Downloads',
        level: 'success',
      };
    case 'cancelled':
      return null;
    case 'revealed-fallback':
      return {
        message:
          locale === 'zh-CN'
            ? '已复制完整路径并打开所在文件夹，请手动拷贝文件'
            : 'Path copied and folder opened — copy the file manually',
        level: 'info',
      };
    case 'failed':
      return {
        message: locale === 'zh-CN' ? '另存为失败' : 'Save As failed',
        level: 'error',
      };
  }
}

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
  if (isTauriRuntime()) {
    try {
      const dest = await chooseSaveAsPath(fileName);
      if (dest === null) {
        return { kind: 'cancelled' };
      }
      if (await copyLocalFileToPath(absolutePath, dest)) {
        return { kind: 'saved' };
      }
      const nativeBlob = await readSourceBlob(absolutePath, options?.readBytes);
      if (!nativeBlob) {
        return { kind: 'failed' };
      }
      const written = await writeBlobToPath(dest, nativeBlob);
      return { kind: written ? 'saved' : 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }

  const blob = await readSourceBlob(absolutePath, options?.readBytes);
  if (blob) {
    return offerBrowserSave(blob, fileName);
  }

  try {
    await navigator.clipboard.writeText(absolutePath);
  } catch {
    // ignore clipboard failures; still try reveal
  }
  const revealed = await revealLocalFileInFolder(absolutePath);
  return revealed.ok ? { kind: 'revealed-fallback' } : { kind: 'failed' };
}

async function readSourceBlob(
  absolutePath: string,
  readBytes: LocalFileBytesReader | undefined,
): Promise<Blob | null> {
  const assetBlob = await tryReadLocalFileBlob(absolutePath);
  if (assetBlob) {
    return assetBlob;
  }
  if (!readBytes) {
    return null;
  }
  try {
    const exported = await readBytes(absolutePath);
    return exported ? bytesToBlob(exported) : null;
  } catch {
    return null;
  }
}

export type RevealLocalFileResult =
  | { ok: true }
  /**
   * `missing` — the path itself is absent while its parent folder exists.
   * Callers must not silently open the parent: that lands the user in the
   * project root instead of the folder the path named. They may still resolve
   * the real file (`project/find-file`) before reporting a failure.
   */
  | { ok: false; reason: 'not-desktop' | 'failed' | 'not-local' | 'missing' };

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
      // The folder is here but the file is not: say so instead of opening the
      // wrong folder (the native command falls back to the parent directory).
      return { ok: false, reason: 'missing' };
    }
    await invoke('reveal_in_file_manager', { path: absolutePath });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Save / copy helpers for the media-image context menu.
 * Prefer the vault original (local path or full object URL), never a grid thumb.
 */
import { saveLocalFileAs, saveMediaUrlAs, type SaveLocalFileAsResult } from './local-file-actions.js';
import { copyImageToClipboard } from './copy-image-to-clipboard.js';
import { looksLikeFilesystemWorkspacePath } from './workspace-open.js';

export type MediaImageBytesSource = {
  fileName: string;
  absolutePath?: string;
  /** Full-resolution URL already in memory (chat lightbox). Never a thumb. */
  srcUrl?: string;
  /** Fetch the original when path/src are missing (library remote). */
  loadOriginalUrl?: () => Promise<string | null>;
  saveLocalPath?: (absolutePath: string) => Promise<SaveLocalFileAsResult>;
};

async function assetUrlForLocalPath(absolutePath: string): Promise<string | null> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    if (typeof convertFileSrc !== 'function') {
      return null;
    }
    return convertFileSrc(absolutePath);
  } catch {
    return null;
  }
}

async function resolveOriginalSrc(
  input: MediaImageBytesSource,
): Promise<{ url: string; owned: boolean } | null> {
  if (input.srcUrl) {
    return { url: input.srcUrl, owned: false };
  }
  if (input.absolutePath && looksLikeFilesystemWorkspacePath(input.absolutePath)) {
    const assetUrl = await assetUrlForLocalPath(input.absolutePath);
    if (assetUrl) {
      return { url: assetUrl, owned: false };
    }
  }
  if (!input.loadOriginalUrl) {
    return null;
  }
  const url = await input.loadOriginalUrl();
  if (!url) {
    return null;
  }
  return { url, owned: true };
}

function releaseOwnedUrl(owned: boolean, url: string): void {
  if (owned && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

export async function saveMediaImageAs(
  input: MediaImageBytesSource,
): Promise<SaveLocalFileAsResult> {
  if (input.absolutePath && looksLikeFilesystemWorkspacePath(input.absolutePath)) {
    if (input.saveLocalPath) {
      return input.saveLocalPath(input.absolutePath);
    }
    return saveLocalFileAs(input.absolutePath);
  }
  const resolved = await resolveOriginalSrc(input);
  if (!resolved) {
    return { kind: 'failed' };
  }
  try {
    return await saveMediaUrlAs(resolved.url, input.fileName);
  } finally {
    releaseOwnedUrl(resolved.owned, resolved.url);
  }
}

export async function copyMediaImage(input: MediaImageBytesSource): Promise<boolean> {
  const resolved = await resolveOriginalSrc(input);
  if (!resolved) {
    return false;
  }
  try {
    return await copyImageToClipboard(resolved.url);
  } finally {
    releaseOwnedUrl(resolved.owned, resolved.url);
  }
}

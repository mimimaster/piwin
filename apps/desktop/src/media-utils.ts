import type { MediaAttachmentRef } from '@piwin/contracts';

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export type PendingComposerAttachment = {
  localId: string;
  attachment: MediaAttachmentRef;
  previewUrl: string;
};

export function isAllowedImageFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  return ALLOWED_IMAGE_MIME.has(mime);
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Only convert paths that look like piwin media store paths.
 * Prevents turning arbitrary model/path strings into asset URLs.
 */
export function isPiwinMediaPath(absolutePath: string): boolean {
  const normalized = absolutePath.replace(/\\/g, '/');
  return (
    normalized.includes('/.piwin/media/') ||
    normalized.includes('/piwin-mock-media/') ||
    /\/media\/[A-Za-z0-9._-]+\//.test(normalized)
  );
}

export async function resolveMediaPreviewUrl(absolutePath: string): Promise<string | null> {
  if (!isPiwinMediaPath(absolutePath)) {
    return null;
  }
  try {
    const core = await import('@tauri-apps/api/core');
    if (typeof core.convertFileSrc === 'function') {
      // Prefer named protocol "piwinmedia" when configured; fall back to default asset.
      try {
        return core.convertFileSrc(absolutePath, 'piwinmedia');
      } catch {
        return core.convertFileSrc(absolutePath);
      }
    }
  } catch {
    // browser / non-tauri
  }
  return null;
}

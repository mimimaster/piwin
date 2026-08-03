import type { PromptAttachment } from '@piwin/contracts';

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export type PendingComposerAttachment = {
  localId: string;
  attachment: PromptAttachment;
  /**
   * Object URL for local image previews. Web-element attachments have no
   * local blob; this is an empty string for `kind: 'web-element'`.
   */
  previewUrl: string;
};

/**
 * Resolve a paste/drop/file image MIME type.
 * Clipboard/Finder pastes often have empty `file.type` on macOS — sniff extension
 * and magic bytes so we still accept the image.
 */
export function resolveImageMimeType(file: File, headerBytes?: Uint8Array): string | null {
  const declared = file.type.trim().toLowerCase();
  if (ALLOWED_IMAGE_MIME.has(declared)) {
    return declared === 'image/jpg' ? 'image/jpeg' : declared;
  }

  const name = file.name.trim().toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';

  if (headerBytes && headerBytes.byteLength >= 12) {
    // PNG: 89 50 4E 47
    if (
      headerBytes[0] === 0x89 &&
      headerBytes[1] === 0x50 &&
      headerBytes[2] === 0x4e &&
      headerBytes[3] === 0x47
    ) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff) {
      return 'image/jpeg';
    }
    // GIF: GIF8
    if (
      headerBytes[0] === 0x47 &&
      headerBytes[1] === 0x49 &&
      headerBytes[2] === 0x46 &&
      headerBytes[3] === 0x38
    ) {
      return 'image/gif';
    }
    // WEBP: RIFF....WEBP
    if (
      headerBytes[0] === 0x52 &&
      headerBytes[1] === 0x49 &&
      headerBytes[2] === 0x46 &&
      headerBytes[3] === 0x46 &&
      headerBytes[8] === 0x57 &&
      headerBytes[9] === 0x45 &&
      headerBytes[10] === 0x42 &&
      headerBytes[11] === 0x50
    ) {
      return 'image/webp';
    }
  }

  return null;
}

export function isAllowedImageFile(file: File): boolean {
  return resolveImageMimeType(file) !== null;
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
      // Default protocol is `asset` — matches tauri.conf.json CSP
      // (`img-src … asset: http://asset.localhost …`) and assetProtocol.scope
      // for `$HOME/.piwin/media/**`. A custom protocol like `piwinmedia`
      // is not registered and is blocked by CSP (broken-image "?" in chat).
      return core.convertFileSrc(absolutePath);
    }
  } catch {
    // browser / non-tauri
  }
  return null;
}

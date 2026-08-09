/** Shared attachment classification used by Desktop, Media and Host layers. */

export type AttachmentContentKind = 'image' | 'text' | 'document';

export const ATTACHMENT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
] as const;

export const ATTACHMENT_DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

export const ATTACHMENT_TEXT_MIME_TYPES = [
  'application/json',
  'application/javascript',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/xml',
  'application/x-sh',
  'application/x-yaml',
  'application/yaml',
  'image/svg+xml',
  'text/css',
  'text/csv',
  'text/html',
  'text/javascript',
  'text/markdown',
  'text/plain',
  'text/tab-separated-values',
  'text/xml',
] as const;

const TEXT_MIME_TYPES = new Set<string>(ATTACHMENT_TEXT_MIME_TYPES);

/** Built-in P0/P1 allowlist for a new Piwin installation. */
export const DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES = [
  ...ATTACHMENT_IMAGE_MIME_TYPES.filter((mimeType) => mimeType !== 'image/jpg'),
  ...ATTACHMENT_DOCUMENT_MIME_TYPES,
  'text/*',
  ...ATTACHMENT_TEXT_MIME_TYPES.filter((mimeType) => !mimeType.startsWith('text/')),
] as const;

const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  '.c': 'text/x-c',
  '.cc': 'text/x-c++',
  '.cpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.diff': 'text/x-diff',
  '.gif': 'image/gif',
  '.go': 'text/x-go',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.html': 'text/html',
  '.java': 'text/x-java-source',
  '.js': 'application/javascript',
  '.jsx': 'application/javascript',
  '.json': 'application/json',
  '.kt': 'text/x-kotlin',
  '.kts': 'text/x-kotlin',
  '.less': 'text/css',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.mjs': 'application/javascript',
  '.patch': 'text/x-diff',
  '.pdf': 'application/pdf',
  '.php': 'text/x-php',
  '.pl': 'text/x-perl',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.rs': 'text/x-rust',
  '.scss': 'text/css',
  '.sh': 'application/x-sh',
  '.sql': 'application/sql',
  '.svg': 'image/svg+xml',
  '.swift': 'text/x-swift',
  '.toml': 'application/toml',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.txt': 'text/plain',
  '.vue': 'text/html',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.zsh': 'application/x-sh',
};

export const ATTACHMENT_FILE_ACCEPT = [
  ...ATTACHMENT_IMAGE_MIME_TYPES,
  ...ATTACHMENT_DOCUMENT_MIME_TYPES,
  ...ATTACHMENT_TEXT_MIME_TYPES,
  'text/*',
  ...Object.keys(EXTENSION_TO_MIME),
].join(',');

export function contentKindForMimeType(mimeType: string): AttachmentContentKind | null {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/svg+xml' || normalized.startsWith('text/')) {
    return 'text';
  }
  if ((ATTACHMENT_IMAGE_MIME_TYPES as readonly string[]).includes(normalized)) {
    return 'image';
  }
  if (TEXT_MIME_TYPES.has(normalized) || normalized.endsWith('+json')) {
    return 'text';
  }
  if ((ATTACHMENT_DOCUMENT_MIME_TYPES as readonly string[]).includes(normalized)) {
    return 'document';
  }
  return null;
}

export function isSupportedAttachmentMimeType(mimeType: string): boolean {
  return contentKindForMimeType(mimeType) !== null;
}

/**
 * Infer a safe, supported MIME type from browser metadata, filename and magic
 * bytes. Browser-provided MIME values are hints only.
 */
export function inferAttachmentMimeType(
  fileName: string,
  declaredMimeType?: string,
  headerBytes?: Uint8Array,
): string | null {
  const declared = declaredMimeType?.trim().toLowerCase() ?? '';
  if (isSupportedAttachmentMimeType(declared)) {
    return declared === 'image/jpg' ? 'image/jpeg' : declared;
  }

  if (headerBytes && headerBytes.byteLength >= 5) {
    if (
      headerBytes[0] === 0x89 &&
      headerBytes[1] === 0x50 &&
      headerBytes[2] === 0x4e &&
      headerBytes[3] === 0x47
    ) {
      return 'image/png';
    }
    if (headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      headerBytes[0] === 0x47 &&
      headerBytes[1] === 0x49 &&
      headerBytes[2] === 0x46 &&
      headerBytes[3] === 0x38
    ) {
      return 'image/gif';
    }
    if (
      headerBytes.byteLength >= 12 &&
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
    if (
      headerBytes[0] === 0x25 &&
      headerBytes[1] === 0x50 &&
      headerBytes[2] === 0x44 &&
      headerBytes[3] === 0x46 &&
      headerBytes[4] === 0x2d
    ) {
      return 'application/pdf';
    }
  }

  const extension = fileExtension(fileName);
  const extensionMimeType = EXTENSION_TO_MIME[extension];
  if (extensionMimeType) {
    return extensionMimeType;
  }
  const normalizedFileName = fileName.trim().replaceAll('\\', '/');
  const baseName = normalizedFileName.slice(normalizedFileName.lastIndexOf('/') + 1).toLowerCase();
  return ['dockerfile', 'makefile', 'license', 'readme', '.env.example'].includes(baseName)
    ? 'text/plain'
    : null;
}

export function fileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  const baseName = normalized.slice(lastSlash + 1);
  const dot = baseName.lastIndexOf('.');
  return dot > 0 ? baseName.slice(dot) : '';
}

export function attachmentContentKindForFile(
  fileName: string,
  declaredMimeType?: string,
  headerBytes?: Uint8Array,
): AttachmentContentKind | null {
  const mimeType = inferAttachmentMimeType(fileName, declaredMimeType, headerBytes);
  return mimeType ? contentKindForMimeType(mimeType) : null;
}

export function attachmentNameFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'attachment';
}

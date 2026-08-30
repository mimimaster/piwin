import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { contentKindForMimeType } from '@piwin/contracts';
import type {
  MediaReadFailureReason,
  MediaThumbEdge,
  SaveMediaInput,
  SavedMediaAsset,
} from '@piwin/contracts';
import { assertAttachmentPayloadSafe } from './attachment-policy.js';

export type MediaServiceOptions = {
  mediaRoot: string;
  maxPasteBytes: number;
  allowedMimeTypes: string[];
};

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'text/html': '.html',
  'text/css': '.css',
  'application/javascript': '.js',
  'application/typescript': '.ts',
  'application/xml': '.xml',
  'application/yaml': '.yaml',
  'application/toml': '.toml',
  'application/x-sh': '.sh',
  'application/sql': '.sql',
  'image/svg+xml': '.svg',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/zip': '.zip',
};

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.sh': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.sql': 'application/sql',
  '.svg': 'image/svg+xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
};

export type ReadMediaInput = {
  sessionId: string;
  assetId: string;
  maxBytes: number;
  thumbEdge?: MediaThumbEdge;
};

export type ReadMediaResult =
  | {
      status: 'ready';
      assetId: string;
      sessionId: string;
      mimeType: string;
      byteSize: number;
      bytes: Uint8Array;
    }
  | {
      status: 'unavailable';
      reason: MediaReadFailureReason;
    };

export function createMediaService(options: MediaServiceOptions) {
  return {
    async saveMediaAsset(input: SaveMediaInput): Promise<SavedMediaAsset> {
      return saveMediaAsset(options, input);
    },
    async readMediaAsset(input: ReadMediaInput): Promise<ReadMediaResult> {
      return readMediaAsset(options, input);
    },
    async readMediaThumb(input: ReadMediaInput): Promise<ReadMediaResult> {
      const { readMediaThumb } = await import('./media-thumb.js');
      return readMediaThumb(options, input);
    },
    async deleteMediaAsset(input: { sessionId: string; assetId: string }): Promise<boolean> {
      return deleteMediaAsset(options, input);
    },
    resolveMediaPath(absolutePath: string): string {
      return assertInsideMediaRoot(options.mediaRoot, absolutePath);
    },
  };
}

export async function saveMediaAsset(
  options: MediaServiceOptions,
  input: SaveMediaInput,
): Promise<SavedMediaAsset> {
  const mimeType = input.mimeType.toLowerCase();
  if (!isAllowedMimeType(options.allowedMimeTypes, mimeType)) {
    throw new Error(`mime type not allowed: ${input.mimeType}`);
  }
  if (input.bytes.byteLength === 0) {
    throw new Error('empty media payload');
  }
  if (input.bytes.byteLength > options.maxPasteBytes) {
    throw new Error(`media too large: ${input.bytes.byteLength} > max ${options.maxPasteBytes}`);
  }

  assertAttachmentPayloadSafe(input);

  const sessionId = sanitizeSegment(input.sessionId);
  const id = randomUUID();
  const extension = MIME_TO_EXT[mimeType] ?? safeExtFromName(input.name, mimeType);
  const directory = join(options.mediaRoot, sessionId);
  await mkdir(directory, { recursive: true });
  // Validate the real session directory before writing — a symlinked
  // session dir would pass the string prefix check but writeFile follows
  // the symlink and writes outside the root.
  await assertRealPathInsideMediaRoot(options.mediaRoot, directory);
  const absolutePath = resolve(directory, `${id}${extension}`);
  assertInsideMediaRoot(options.mediaRoot, absolutePath);
  await writeFile(absolutePath, input.bytes);
  await assertRealPathInsideMediaRoot(options.mediaRoot, absolutePath);
  if (mimeType.startsWith('image/')) {
    const { writeMediaThumbFromFile } = await import('./media-thumb.js');
    await writeMediaThumbFromFile(options, {
      sessionDir: directory,
      assetId: id,
      sourcePath: absolutePath,
    });
  }

  const asset: SavedMediaAsset = {
    id,
    sessionId,
    absolutePath,
    mimeType,
    byteSize: input.bytes.byteLength,
    createdAt: new Date().toISOString(),
  };
  const name = input.name?.trim();
  const contentKind = input.contentKind ?? contentKindForMimeType(mimeType);
  if (name) {
    asset.name = name;
  }
  if (contentKind) {
    asset.contentKind = contentKind;
  }
  return asset;
}

function isAllowedMimeType(allowedMimeTypes: readonly string[], mimeType: string): boolean {
  return allowedMimeTypes.some((allowed) => {
    const normalized = allowed.trim().toLowerCase();
    return (
      normalized === mimeType ||
      (normalized.endsWith('/*') && mimeType.startsWith(normalized.slice(0, -1)))
    );
  });
}

export function assertInsideMediaRoot(mediaRoot: string, absolutePath: string): string {
  const root = resolve(mediaRoot);
  const target = resolve(absolutePath);
  if (target !== root && !target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
    throw new Error(`path escapes media root: ${absolutePath}`);
  }
  return target;
}

/**
 * Read a vault asset by logical identity (ADR 0052). Callers never supply a
 * host path: the file is located under `<mediaRoot>/<sessionId>/<assetId><ext>`
 * and every hop is containment-checked (string prefix + realpath), mirroring
 * the write path's defenses. Oversized assets are rejected whole — a
 * truncated image would render as corruption, not a preview.
 */
type LocatedVaultFile =
  | {
      status: 'ready';
      sessionId: string;
      assetId: string;
      directory: string;
      fileName: string;
      absolutePath: string;
    }
  | { status: 'unavailable'; reason: MediaReadFailureReason };

export async function locateVaultFile(
  options: Pick<MediaServiceOptions, 'mediaRoot'>,
  input: { sessionId: string; assetId: string },
): Promise<LocatedVaultFile> {
  let sessionId: string;
  let assetId: string;
  try {
    sessionId = sanitizeSegment(input.sessionId);
    assetId = sanitizeSegment(input.assetId);
  } catch {
    return { status: 'unavailable', reason: 'invalid-request' };
  }

  const root = resolve(options.mediaRoot);
  let directory: string;
  try {
    directory = assertInsideMediaRoot(root, join(root, sessionId));
  } catch {
    return { status: 'unavailable', reason: 'outside-media-root' };
  }

  const entries = await readdir(directory).catch(() => null);
  if (entries === null) {
    return { status: 'unavailable', reason: 'not-found' };
  }
  const hasNonJsonSibling = entries.some(
    (name) =>
      name.startsWith(`${assetId}.`) &&
      !name.endsWith('.json') &&
      !name.endsWith('.meta.json') &&
      !name.includes('.thumb.'),
  );
  const fileName =
    entries.find((name) => name === assetId) ??
    entries.find((name) => {
      if (!name.startsWith(`${assetId}.`)) {
        return false;
      }
      const extension = name.slice(assetId.length + 1);
      // Sidecars are `<assetId>.json` or `<assetId>.meta.json`; never treat
      // them as the media file.
      if (extension === 'json') {
        return !hasNonJsonSibling;
      }
      return /^[a-zA-Z0-9]{0,12}$/.test(extension);
    });
  if (fileName === undefined) {
    return { status: 'unavailable', reason: 'not-found' };
  }

  const absolutePath = resolve(directory, fileName);
  try {
    assertInsideMediaRoot(root, absolutePath);
    await assertRealPathInsideMediaRoot(root, absolutePath);
  } catch {
    return { status: 'unavailable', reason: 'outside-media-root' };
  }

  const fileStat = await stat(absolutePath).catch(() => null);
  if (fileStat === null || !fileStat.isFile()) {
    return { status: 'unavailable', reason: 'not-found' };
  }
  return { status: 'ready', sessionId, assetId, directory, fileName, absolutePath };
}

export async function readMediaAsset(
  options: Pick<MediaServiceOptions, 'mediaRoot'>,
  input: ReadMediaInput,
): Promise<ReadMediaResult> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
    return { status: 'unavailable', reason: 'invalid-request' };
  }
  const located = await locateVaultFile(options, input);
  if (located.status === 'unavailable') {
    return located;
  }
  const fileStat = await stat(located.absolutePath).catch(() => null);
  if (fileStat === null || !fileStat.isFile()) {
    return { status: 'unavailable', reason: 'not-found' };
  }
  if (fileStat.size > input.maxBytes) {
    return { status: 'unavailable', reason: 'too-large' };
  }

  const bytes = await readFile(located.absolutePath);
  return {
    status: 'ready',
    assetId: located.assetId,
    sessionId: located.sessionId,
    mimeType: EXT_TO_MIME[extname(located.fileName).toLowerCase()] ?? 'application/octet-stream',
    byteSize: bytes.byteLength,
    bytes,
  };
}

export async function deleteMediaAsset(
  options: Pick<MediaServiceOptions, 'mediaRoot'>,
  input: { sessionId: string; assetId: string },
): Promise<boolean> {
  const located = await locateVaultFile(options, input);
  if (located.status === 'unavailable') {
    return false;
  }
  await unlink(located.absolutePath);
  const { deleteMediaThumb } = await import('./media-thumb.js');
  await deleteMediaThumb(options, {
    sessionDir: located.directory,
    assetId: located.assetId,
  });
  for (const sidecarName of [`${located.assetId}.json`, `${located.assetId}.meta.json`]) {
    const sidecarPath = resolve(located.directory, sidecarName);
    try {
      assertInsideMediaRoot(resolve(options.mediaRoot), sidecarPath);
      await unlink(sidecarPath);
    } catch {
      // Sidecar is optional; missing or escaping paths are not a delete failure.
    }
  }
  return true;
}

/**
 * Resolve symlinks then re-validate the real path stays under media root.
 * `assertInsideMediaRoot` alone is insufficient because `path.resolve()`
 * does not follow symlinks — a symlinked session dir pointing outside the
 * root would pass the string prefix check but write outside the root.
 */
export async function assertRealPathInsideMediaRoot(
  mediaRoot: string,
  absolutePath: string,
): Promise<string> {
  const realPath = await realpath(absolutePath);
  // Resolve the root via realpath too so the comparison is consistent —
  // on macOS the OS temp dir (`/var/folders/...`) is a symlink to
  // `/private/var/folders/...`, so comparing realpath(target) against
  // resolve(root) would falsely reject legitimate writes.
  const realRoot = await realpath(mediaRoot);
  return assertInsideMediaRoot(realRoot, realPath);
}

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned) {
    throw new Error('invalid session id');
  }
  return cleaned;
}

function safeExtFromName(name: string | undefined, mimeType: string): string {
  const candidate = name ? extname(name).toLowerCase() : '';
  if (/^\.[a-z0-9]{1,12}$/u.test(candidate)) {
    return candidate;
  }
  const slash = mimeType.indexOf('/');
  if (slash === -1) {
    return '.bin';
  }
  const subtype = mimeType.slice(slash + 1).replace(/[^a-z0-9]/gi, '');
  return subtype ? `.${subtype}` : '.bin';
}

export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { SaveMediaInput, SavedMediaAsset } from '@piwin/contracts';

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
};

export function createMediaService(options: MediaServiceOptions) {
  return {
    async saveMediaAsset(input: SaveMediaInput): Promise<SavedMediaAsset> {
      return saveMediaAsset(options, input);
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
  if (!options.allowedMimeTypes.map((item) => item.toLowerCase()).includes(mimeType)) {
    throw new Error(`mime type not allowed: ${input.mimeType}`);
  }
  if (input.bytes.byteLength === 0) {
    throw new Error('empty media payload');
  }
  if (input.bytes.byteLength > options.maxPasteBytes) {
    throw new Error(`media too large: ${input.bytes.byteLength} > max ${options.maxPasteBytes}`);
  }

  const sessionId = sanitizeSegment(input.sessionId);
  const id = randomUUID();
  const extension = MIME_TO_EXT[mimeType] ?? safeExtFromName(mimeType);
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

  const asset: SavedMediaAsset = {
    id,
    sessionId,
    absolutePath,
    mimeType,
    byteSize: input.bytes.byteLength,
    createdAt: new Date().toISOString(),
  };
  return asset;
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

function safeExtFromName(mimeType: string): string {
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

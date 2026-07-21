import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
    throw new Error(
      `media too large: ${input.bytes.byteLength} > max ${options.maxPasteBytes}`,
    );
  }

  const sessionId = sanitizeSegment(input.sessionId);
  const id = randomUUID();
  const extension = MIME_TO_EXT[mimeType] ?? safeExtFromName(mimeType);
  const directory = join(options.mediaRoot, sessionId);
  await mkdir(directory, { recursive: true });
  const absolutePath = resolve(directory, `${id}${extension}`);
  assertInsideMediaRoot(options.mediaRoot, absolutePath);
  await writeFile(absolutePath, input.bytes);

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

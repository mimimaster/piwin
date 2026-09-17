/**
 * Vault gallery thumbs. Grid tiles must never decode the original:
 * Host writes `<assetId>.thumb.256.webp` and `.thumb.384.webp` next to the file.
 */
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MEDIA_THUMB_EDGE_STANDARD_PX,
  MEDIA_THUMB_EDGES,
  MEDIA_THUMB_MIME,
  isMediaThumbEdge,
  isMediaThumbFileName,
  mediaThumbFileName,
  type MediaLibraryItem,
  type MediaThumbEdge,
} from '@piwin/contracts';
import sharp from 'sharp';
import {
  assertInsideMediaRoot,
  assertRealPathInsideMediaRoot,
  locateVaultFile,
  type MediaServiceOptions,
  type ReadMediaInput,
  type ReadMediaResult,
} from './media-service.js';

const THUMB_WRITE_CONCURRENCY = 2;
const LEGACY_THUMB_SUFFIX = '.thumb.webp';

export function mediaThumbPath(
  sessionDir: string,
  assetId: string,
  edge: MediaThumbEdge,
): string {
  return resolve(sessionDir, mediaThumbFileName(assetId, edge));
}

async function writeOneThumb(
  options: Pick<MediaServiceOptions, 'mediaRoot'>,
  input: { sessionDir: string; assetId: string; sourcePath: string; edge: MediaThumbEdge },
): Promise<string | null> {
  const root = resolve(options.mediaRoot);
  const thumbPath = mediaThumbPath(input.sessionDir, input.assetId, input.edge);
  try {
    assertInsideMediaRoot(root, input.sourcePath);
    assertInsideMediaRoot(root, thumbPath);
    await assertRealPathInsideMediaRoot(root, input.sourcePath);
    const bytes = await sharp(input.sourcePath)
      .rotate()
      .resize(input.edge, input.edge, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer();
    await writeFile(thumbPath, bytes);
    await assertRealPathInsideMediaRoot(root, thumbPath);
    return thumbPath;
  } catch {
    return null;
  }
}

/**
 * Downscaled WebP for previewing an arbitrary (already path-checked) image,
 * held in memory rather than written beside the source. Null when sharp
 * cannot decode the file.
 */
export async function renderImagePreviewWebp(
  sourcePath: string,
  input: { edge: number; quality: number },
): Promise<Buffer | null> {
  try {
    return await sharp(sourcePath)
      .rotate()
      .resize(input.edge, input.edge, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: input.quality })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function writeMediaThumbFromFile(
  options: Pick<MediaServiceOptions, 'mediaRoot'>,
  input: { sessionDir: string; assetId: string; sourcePath: string; edge?: MediaThumbEdge },
): Promise<string | null> {
  if (input.edge !== undefined) {
    return writeOneThumb(options, { ...input, edge: input.edge });
  }
  const [dense, standard] = await Promise.all(
    MEDIA_THUMB_EDGES.map((edge) => writeOneThumb(options, { ...input, edge })),
  );
  return standard ?? dense ?? null;
}

export async function ensureMediaThumb(
  options: Pick<MediaServiceOptions, 'mediaRoot'>,
  input: { sessionDir: string; assetId: string; sourcePath: string; edge?: MediaThumbEdge },
): Promise<string | null> {
  const edge = input.edge ?? MEDIA_THUMB_EDGE_STANDARD_PX;
  const thumbPath = mediaThumbPath(input.sessionDir, input.assetId, edge);
  try {
    assertInsideMediaRoot(resolve(options.mediaRoot), thumbPath);
    await access(thumbPath);
    return thumbPath;
  } catch {
    return writeOneThumb(options, { ...input, edge });
  }
}

export async function deleteMediaThumb(
  options: Pick<MediaServiceOptions, 'mediaRoot'>,
  input: { sessionDir: string; assetId: string },
): Promise<void> {
  const root = resolve(options.mediaRoot);
  const names = [
    ...MEDIA_THUMB_EDGES.map((edge) => mediaThumbFileName(input.assetId, edge)),
    `${input.assetId}${LEGACY_THUMB_SUFFIX}`,
  ];
  for (const fileName of names) {
    const thumbPath = resolve(input.sessionDir, fileName);
    try {
      assertInsideMediaRoot(root, thumbPath);
      await unlink(thumbPath);
    } catch {
      // Thumb is optional.
    }
  }
}

export async function attachLibraryThumbs(
  options: Pick<MediaServiceOptions, 'mediaRoot'>,
  items: MediaLibraryItem[],
): Promise<MediaLibraryItem[]> {
  if (items.length === 0) {
    return items;
  }
  const attached = items.slice();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < attached.length) {
      const index = cursor;
      cursor += 1;
      const item = attached[index];
      if (!item || item.kind !== 'image' || !item.absolutePath) {
        continue;
      }
      const sourcePath = item.absolutePath;
      const sessionDir = resolve(sourcePath, '..');
      const [dense, standard] = await Promise.all(
        MEDIA_THUMB_EDGES.map((edge) =>
          ensureMediaThumb(options, {
            sessionDir,
            assetId: item.assetId,
            sourcePath,
            edge,
          }),
        ),
      );
      const thumbPath = standard ?? dense;
      if (thumbPath) {
        attached[index] = { ...item, thumbAbsolutePath: thumbPath, hasThumb: true };
      }
    }
  };
  const workers = Math.min(THUMB_WRITE_CONCURRENCY, attached.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return attached;
}

export async function readMediaThumb(
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
  if (isMediaThumbFileName(located.fileName)) {
    return { status: 'unavailable', reason: 'invalid-request' };
  }
  const edge = isMediaThumbEdge(input.thumbEdge) ? input.thumbEdge : MEDIA_THUMB_EDGE_STANDARD_PX;
  const thumbPath = await ensureMediaThumb(options, {
    sessionDir: located.directory,
    assetId: located.assetId,
    sourcePath: located.absolutePath,
    edge,
  });
  if (!thumbPath) {
    return { status: 'unavailable', reason: 'not-found' };
  }
  const bytes = await readFile(thumbPath);
  if (bytes.byteLength > input.maxBytes) {
    return { status: 'unavailable', reason: 'too-large' };
  }
  return {
    status: 'ready',
    assetId: located.assetId,
    sessionId: located.sessionId,
    mimeType: MEDIA_THUMB_MIME,
    byteSize: bytes.byteLength,
    bytes,
  };
}

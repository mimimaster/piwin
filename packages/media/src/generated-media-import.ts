import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { contentKindForMimeType, inferAttachmentMimeType } from '@piwin/contracts';
import type { ImportGeneratedMediaInput, SavedMediaAsset } from '@piwin/contracts';
import { writeMediaLibraryMeta } from './media-library.js';
import {
  assertInsideMediaRoot, assertRealPathInsideMediaRoot, contentHash, locateVaultFile,
  saveMediaAsset, type MediaServiceOptions,
} from './media-service.js';

const pendingImports = new Map<string, Promise<SavedMediaAsset>>();

/** Import only files inside a trusted backend output directory, never arbitrary tool paths. */
export async function importGeneratedMediaAsset(
  options: MediaServiceOptions,
  input: ImportGeneratedMediaInput,
): Promise<SavedMediaAsset> {
  let sourcePath: string;
  try {
    assertInsideMediaRoot(input.sourceRoot, input.sourcePath);
    sourcePath = await assertRealPathInsideMediaRoot(input.sourceRoot, input.sourcePath);
  } catch (error) {
    throw new Error('generated media escapes or cannot be read within source root', { cause: error });
  }
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(input.sessionId)) {
    throw new Error('invalid generated media session id');
  }
  const handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Uint8Array;
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size === 0) throw new Error('empty generated media file');
    if (details.size > options.maxPasteBytes) throw new Error('generated media too large');
    // Read through the checked handle with a fixed allocation even if the source grows.
    bytes = new Uint8Array(details.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error('generated media changed during import');
  } finally {
    await handle.close();
  }
  // Live adapter emissions and legacy Host backfill can name different import
  // keys for the same output. The checked source file and its bytes own identity.
  const identity = contentHash(Buffer.from(`${sourcePath}:${contentHash(bytes)}`));
  const receiptPath = assertInsideMediaRoot(options.mediaRoot,
    resolve(options.mediaRoot, input.sessionId, '.imports', `${identity}.json`));
  const existing = pendingImports.get(receiptPath);
  if (existing) return existing;
  const pending = saveImport(options, input, bytes, receiptPath);
  pendingImports.set(receiptPath, pending);
  try { return await pending; } finally { pendingImports.delete(receiptPath); }
}

async function saveImport(
  options: MediaServiceOptions, input: ImportGeneratedMediaInput,
  bytes: Uint8Array, receiptPath: string,
): Promise<SavedMediaAsset> {
  try {
    await assertRealPathInsideMediaRoot(options.mediaRoot, receiptPath);
    const parsed: unknown = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'id' in parsed && typeof parsed.id === 'string') {
      const asset = await restoreImportedAsset(options, input, parsed.id);
      if (asset !== undefined) return asset;
    }
  } catch (error) {
    // Missing receipts are normal on first import; invalid ones must not hide I/O failures.
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const mimeType = inferAttachmentMimeType(basename(input.sourcePath));
  if (!mimeType || !mimeType.startsWith(`${input.kind}/`)) throw new Error('generated media kind does not match file');
  const previous = await findLegacyImportedAsset(options, input, bytes, dirname(receiptPath));
  const asset = previous ?? await saveMediaAsset(options, {
    sessionId: input.sessionId, bytes, mimeType, name: basename(input.sourcePath), source: 'generated',
  });
  if (previous === undefined) await writeMediaLibraryMeta(options, asset.sessionId, asset.id, {
    source: 'generated', kind: input.kind, createdAt: input.createdAt ?? asset.createdAt,
    ...(input.prompt ? { prompt: input.prompt } : {}), ...(input.model ? { model: input.model } : {}),
  });
  await mkdir(dirname(receiptPath), { recursive: true });
  await assertRealPathInsideMediaRoot(options.mediaRoot, dirname(receiptPath));
  await writeFile(receiptPath, JSON.stringify({ id: asset.id, sourcePath: resolve(input.sourcePath) }), { flag: 'wx' });
  return asset;
}

async function restoreImportedAsset(
  options: MediaServiceOptions, input: ImportGeneratedMediaInput, assetId: string,
): Promise<SavedMediaAsset | undefined> {
  const located = await locateVaultFile(options, { sessionId: input.sessionId, assetId });
  if (located.status !== 'ready') return undefined;
  const mimeType = inferAttachmentMimeType(basename(located.absolutePath)) ?? 'application/octet-stream';
  const contentKind = contentKindForMimeType(mimeType);
  return {
    id: assetId, sessionId: input.sessionId, absolutePath: located.absolutePath,
    mimeType, name: basename(input.sourcePath),
    ...(contentKind !== null ? { contentKind } : {}),
    byteSize: (await stat(located.absolutePath)).size,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/** Old receipts contain only an asset id. Reuse matching bytes once, then write a stable receipt. */
async function findLegacyImportedAsset(
  options: MediaServiceOptions, input: ImportGeneratedMediaInput,
  bytes: Uint8Array, receiptDirectory: string,
): Promise<SavedMediaAsset | undefined> {
  let receipts: string[];
  try {
    await assertRealPathInsideMediaRoot(options.mediaRoot, receiptDirectory);
    receipts = await readdir(receiptDirectory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  for (const receipt of receipts) {
    if (!receipt.endsWith('.json')) continue;
    const path = await assertRealPathInsideMediaRoot(options.mediaRoot, resolve(receiptDirectory, receipt));
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('id' in parsed) || typeof parsed.id !== 'string') continue;
    // Source-aware receipts already use the new identity. Only migrate v1.
    if ('sourcePath' in parsed) continue;
    const asset = await restoreImportedAsset(options, input, parsed.id);
    if (asset === undefined || asset.byteSize !== bytes.byteLength || !asset.mimeType.startsWith(`${input.kind}/`)) continue;
    if (contentHash(await readFile(asset.absolutePath)) === contentHash(bytes)) return asset;
  }
  return undefined;
}

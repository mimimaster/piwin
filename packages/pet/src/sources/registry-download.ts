/**
 * Download a pet package tarball/zip from a registry entry, enforcing:
 *   - HTTPS only
 *   - max size cap (PET_MAX_DOWNLOAD_BYTES)
 *   - SHA256 checksum match
 *   - ZIP magic bytes (PK\x03\x04) before accepting
 * Streams to a temp file in destDir, returns the absolute path on success.
 */
import { createHash } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { PetRegistryEntry } from '@piwin/contracts';

export const PET_MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export type DownloadOptions = {
  /** Override global fetch (tests). */
  fetch?: typeof fetch;
  /** Override size cap (tests). */
  maxBytes?: number;
  /** Abort the in-flight download; checked before each streamed chunk. */
  signal?: AbortSignal;
};

export type DownloadResult = {
  filePath: string;
  sizeBytes: number;
};

export async function downloadAndVerifyPackage(
  entry: PetRegistryEntry,
  destDir: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  if (!/^https:\/\//i.test(entry.url)) {
    throw new Error(`registry url must be https: ${entry.url}`);
  }
  const maxBytes = options.maxBytes ?? PET_MAX_DOWNLOAD_BYTES;
  if (entry.sizeBytes > maxBytes) {
    throw new Error(`package too large: ${entry.sizeBytes} > ${maxBytes}`);
  }
  await mkdir(destDir, { recursive: true });
  const tempPath = join(destDir, `${entry.id}.pet.zip.tmp`);
  const finalPath = join(destDir, `${entry.id}.pet.zip`);
  const fetchFn = options.fetch ?? fetch;
  const init: RequestInit = { redirect: 'follow' };
  if (options.signal) init.signal = options.signal;
  const response = await fetchFn(entry.url, init);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }
  const handle = await open(tempPath, 'w');
  const hash = createHash('sha256');
  let total = 0;
  let firstChunk = true;
  try {
    for await (const chunk of response.body as unknown as Iterable<Uint8Array>) {
      if (options.signal?.aborted) throw new Error('download aborted');
      if (firstChunk) {
        firstChunk = false;
        if (chunk.byteLength < 4 || !ZIP_MAGIC.equals(Buffer.from(chunk.buffer, chunk.byteOffset, 4))) {
          throw new Error('invalid package: missing ZIP magic bytes');
        }
      }
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new Error(`package exceeded size cap: ${total} > ${maxBytes}`);
      }
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (total === 0) throw new Error('empty package');
    const digest = hash.digest('hex');
    if (digest !== entry.sha256.toLowerCase()) {
      throw new Error(`sha256 mismatch: expected ${entry.sha256}, got ${digest}`);
    }
  } catch (err) {
    // Best-effort cleanup of the temp file on any failure; ignore cleanup errors.
    await handle.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }
  await handle.close();
  await rename(tempPath, finalPath);
  return { filePath: finalPath, sizeBytes: total };
}

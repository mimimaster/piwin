/**
 * Crash-safe text file replacement for product JSON documents.
 *
 * Write path:
 *   1. unique same-directory temporary file
 *   2. full contents + fsync
 *   3. rename over the destination (atomic on the same filesystem)
 *   4. best-effort fsync of the parent directory (durability of the rename)
 *
 * Callers that need multi-writer safety must still serialize around this helper
 * (process-local queue and/or inter-process lock).
 */
import { randomUUID } from 'node:crypto';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeTextFileAtomic(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, 'utf8');
    const temporaryHandle = await open(temporaryPath, 'r+');
    try {
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  // Durability of the directory entry itself is best-effort: some platforms
  // reject O_RDONLY directory handles. The file body is already fsynced.
  try {
    const directoryHandle = await open(dirname(filePath), 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch {
    // Ignore platform limitations; rename already published the new file.
  }
}

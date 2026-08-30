/**
 * Crash-safe JSON replacement under flashcardsRoot.
 * Temp + fsync + rename; callers still serialize writers.
 */
import { randomUUID } from 'node:crypto';
import { open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type AtomicJsonWriteHooks = {
  failWrite?: (path: string) => Error | undefined;
};

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  hooks?: AtomicJsonWriteHooks,
): Promise<void> {
  const injected = hooks?.failWrite?.(filePath);
  if (injected) throw injected;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
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
  try {
    const directoryHandle = await open(dirname(filePath), 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch {
    // Directory fsync is best-effort; the file body is already durable.
  }
}

export async function isolateCorruptFile(filePath: string): Promise<string> {
  const backupPath = `${filePath}.corrupt`;
  try {
    await rename(filePath, backupPath);
    return backupPath;
  } catch {
    const fallback = `${filePath}.${process.pid}.${randomUUID()}.corrupt`;
    await rename(filePath, fallback);
    return fallback;
  }
}

export async function removeTmpFiles(directory: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.tmp')) continue;
    await rm(join(directory, entry), { force: true });
  }
}

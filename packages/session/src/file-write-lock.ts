/**
 * Serialize a file mutation within this process and across sibling processes.
 *
 * The OS lock covers the read-modify-write interval. Atomic replacement alone
 * prevents torn bytes, but it cannot prevent two processes from both reading
 * the same revision and allowing the last writer to erase the first writer's
 * change.
 */
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const FILE_LOCK_WAIT_MILLISECONDS = 10_000;
const fileWriteQueues = new Map<string, Promise<unknown>>();

export function withFileWriteLock<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const absolutePath = resolvePath(filePath);
  const previous = fileWriteQueues.get(absolutePath) ?? Promise.resolve();
  const runWithFileLock = async (): Promise<T> => {
    const releaseFileLock = await acquireFileLock(absolutePath);
    try {
      return await operation();
    } finally {
      await releaseFileLock();
    }
  };
  const next = previous.then(runWithFileLock, runWithFileLock);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  fileWriteQueues.set(absolutePath, settled);
  void settled.then(() => {
    if (fileWriteQueues.get(absolutePath) === settled) {
      fileWriteQueues.delete(absolutePath);
    }
  });
  return next;
}

async function acquireFileLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  await mkdir(dirname(filePath), { recursive: true });
  const deadline = Date.now() + FILE_LOCK_WAIT_MILLISECONDS;
  while (Date.now() < deadline) {
    const temporaryLockPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
    const token = randomUUID();
    try {
      await writeFile(
        temporaryLockPath,
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token })}\n`,
        'utf8',
      );
      await link(temporaryLockPath, lockPath);
      await rm(temporaryLockPath, { force: true });
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: unknown };
          if (current.token !== token) return;
        } catch (error) {
          if (isNotFound(error)) return;
          throw error;
        }
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      await rm(temporaryLockPath, { force: true });
      if (!isAlreadyExists(error)) {
        throw error;
      }
      if (await removeDeadFileLock(lockPath)) {
        continue;
      }
      await delay(25);
    }
  }
  throw new Error(`Timed out waiting for file lock: ${lockPath}`);
}

async function removeDeadFileLock(lockPath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: unknown };
    if (typeof parsed.pid === 'number' && isProcessAlive(parsed.pid)) {
      return false;
    }
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
  }
  await rm(lockPath, { force: true });
  return true;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'EPERM'
    );
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'EEXIST',
  );
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  );
}

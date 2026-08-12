import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertSafePathSegment } from './paths.js';

const OPERATION_LOCK_WAIT_MILLISECONDS = 10_000;

export type SessionRuntimeLeaseOwner = {
  ownerId: string;
  pid: number;
};

export async function registerSessionRuntimeLease(input: {
  rootDir: string;
  sessionId: string;
  owner: SessionRuntimeLeaseOwner;
}): Promise<void> {
  assertSafePathSegment(input.owner.ownerId, 'runtime lease ownerId');
  const leaseDirectory = getRuntimeLeaseDirectory(input.rootDir, input.sessionId);
  await mkdir(leaseDirectory, { recursive: true });
  const leasePath = join(leaseDirectory, `${input.owner.ownerId}.json`);
  const temporaryPath = `${leasePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ ...input.owner, updatedAt: new Date().toISOString() })}\n`,
      'utf8',
    );
    await rename(temporaryPath, leasePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function releaseSessionRuntimeLease(input: {
  rootDir: string;
  sessionId: string;
  ownerId: string;
}): Promise<void> {
  assertSafePathSegment(input.ownerId, 'runtime lease ownerId');
  await rm(
    join(getRuntimeLeaseDirectory(input.rootDir, input.sessionId), `${input.ownerId}.json`),
    {
      force: true,
    },
  );
}

export async function hasForeignLiveSessionRuntime(input: {
  rootDir: string;
  sessionId: string;
  ownerId: string;
}): Promise<boolean> {
  const leaseDirectory = getRuntimeLeaseDirectory(input.rootDir, input.sessionId);
  let entries: string[];
  try {
    entries = await readdir(leaseDirectory);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry === `${input.ownerId}.json`) {
      continue;
    }
    const leasePath = join(leaseDirectory, entry);
    try {
      const parsed = JSON.parse(await readFile(leasePath, 'utf8')) as { pid?: unknown };
      if (typeof parsed.pid === 'number' && isProcessAlive(parsed.pid)) {
        return true;
      }
      await rm(leasePath, { force: true });
    } catch (error) {
      if (!isNotFound(error)) {
        await rm(leasePath, { force: true });
      }
    }
  }
  return false;
}

export async function withSessionOperationLock<T>(input: {
  rootDir: string;
  sessionId: string;
  operation: () => Promise<T>;
}): Promise<T> {
  const release = await acquireSessionOperationLock(input.rootDir, input.sessionId, false);
  try {
    return await input.operation();
  } finally {
    await release?.();
  }
}

export async function tryWithSessionOperationLock<T>(input: {
  rootDir: string;
  sessionId: string;
  operation: () => Promise<T>;
}): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const release = await acquireSessionOperationLock(input.rootDir, input.sessionId, true);
  if (!release) {
    return { acquired: false };
  }
  try {
    return { acquired: true, value: await input.operation() };
  } finally {
    await release();
  }
}

async function acquireSessionOperationLock(
  rootDir: string,
  sessionId: string,
  tryOnly: boolean,
): Promise<(() => Promise<void>) | undefined> {
  const lockPath = getOperationLockPath(rootDir, sessionId);
  const deadline = Date.now() + OPERATION_LOCK_WAIT_MILLISECONDS;
  await mkdir(join(rootDir, 'locks', 'session-operations'), { recursive: true });
  while (tryOnly || Date.now() < deadline) {
    const temporaryLockPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryLockPath,
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        'utf8',
      );
      await link(temporaryLockPath, lockPath);
      await rm(temporaryLockPath, { force: true });
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      await rm(temporaryLockPath, { force: true });
      if (!isAlreadyExists(error)) {
        throw error;
      }
      if (await removeDeadOperationLock(lockPath)) {
        continue;
      }
      if (tryOnly) {
        return undefined;
      }
      await delay(25);
    }
  }
  throw new Error(`Timed out waiting for session operation lock: ${sessionId}`);
}

async function removeDeadOperationLock(lockPath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as {
      pid?: unknown;
    };
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

function getRuntimeLeaseDirectory(rootDir: string, sessionId: string): string {
  assertSafePathSegment(sessionId, 'sessionId');
  return join(rootDir, 'runtime-leases', sessionId);
}

function getOperationLockPath(rootDir: string, sessionId: string): string {
  assertSafePathSegment(sessionId, 'sessionId');
  return join(rootDir, 'locks', 'session-operations', `${sessionId}.lock`);
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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EEXIST'
  );
}

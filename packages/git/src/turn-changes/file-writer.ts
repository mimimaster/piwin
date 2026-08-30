/**
 * Bounded turn-change file writer. Same-directory temp+rename; unlink one file.
 * Callers must go through assertWritableTurnChangeFile before any mutation.
 */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES } from './object-store.js';
import type { TurnChangeObjectStore } from './object-store.js';
import { assertWritableTurnChangeFile } from './path-policy.js';
import type { ResolvedTurnChangePath } from './path-policy.js';

const NEW_FILE_MODE = 0o644;

export type TurnChangeWriteReceipt = {
  relativePath: string;
  beforeSha: string | null;
  afterSha: string | null;
  beforeExists: boolean;
  afterExists: boolean;
};

export async function writeTurnChangeFile(input: {
  workspaceRoot: string;
  relativePath: string;
  bytes: Uint8Array;
  store: TurnChangeObjectStore;
}): Promise<TurnChangeWriteReceipt> {
  const resolved = await assertWritableTurnChangeFile({
    workspaceRoot: input.workspaceRoot,
    relativePath: input.relativePath,
  });
  assertWithinObjectLimit(input.bytes.byteLength);

  const before = await backupExistingFile(resolved, input.store);
  const parent = dirname(resolved.absolutePath);
  await mkdir(parent, { recursive: true });
  const tempPath = join(parent, `.piwin-tc-${randomUUID()}`);
  try {
    await writeTempFile(tempPath, input.bytes, before.mode);
    await rename(tempPath, resolved.absolutePath);
  } catch (error) {
    if (!errorHasCode(error, 'EEXIST')) {
      await unlink(tempPath).catch(() => undefined);
    }
    throw error;
  }

  const afterBytes = await readFile(resolved.absolutePath);
  const after = await input.store.put(toBytes(afterBytes));
  return {
    relativePath: resolved.relativePath,
    beforeSha: before.sha256,
    afterSha: after.sha256,
    beforeExists: before.exists,
    afterExists: true,
  };
}

export async function deleteTurnChangeFile(input: {
  workspaceRoot: string;
  relativePath: string;
  store: TurnChangeObjectStore;
}): Promise<TurnChangeWriteReceipt> {
  const resolved = await assertWritableTurnChangeFile({
    workspaceRoot: input.workspaceRoot,
    relativePath: input.relativePath,
  });
  if (resolved.kind === 'missing') {
    throw new Error('not found');
  }

  const before = await backupExistingFile(resolved, input.store);
  await unlink(resolved.absolutePath);
  return {
    relativePath: resolved.relativePath,
    beforeSha: before.sha256,
    afterSha: null,
    beforeExists: true,
    afterExists: false,
  };
}

type ExistingBackup = {
  sha256: string | null;
  exists: boolean;
  mode: number;
};

async function backupExistingFile(
  resolved: ResolvedTurnChangePath,
  store: TurnChangeObjectStore,
): Promise<ExistingBackup> {
  if (resolved.kind !== 'file') {
    return { sha256: null, exists: false, mode: NEW_FILE_MODE };
  }

  const handle = await open(resolved.absolutePath, existingFileReadFlags());
  try {
    const stats = await handle.stat();
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`path is not a writable turn-change file`);
    }
    assertWithinObjectLimit(stats.size);
    const bytes = toBytes(await handle.readFile());
    const put = await store.put(bytes);
    return { sha256: put.sha256, exists: true, mode: stats.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

async function writeTempFile(tempPath: string, bytes: Uint8Array, mode: number): Promise<void> {
  // wx: exclusive create so a colliding symlink is not followed.
  const handle = await open(tempPath, 'wx', mode);
  try {
    await handle.writeFile(bytes);
    if (process.platform !== 'win32') {
      await handle.chmod(mode);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertWithinObjectLimit(byteLength: number): void {
  if (byteLength > DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES) {
    throw new Error(`file exceeds maxObjectBytes (${DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES})`);
  }
}

function toBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function existingFileReadFlags(): string | number {
  if (typeof constants.O_NOFOLLOW === 'number') {
    return constants.O_RDONLY | constants.O_NOFOLLOW;
  }
  return 'r';
}

function errorHasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

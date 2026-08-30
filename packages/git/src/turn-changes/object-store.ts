/**
 * Content-addressed byte store for turn-change objects.
 * Layout: <rootDir>/objects/<aa>/<rest-of-sha256> published via temp/<uuid>+rename.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES = 20 * 1024 * 1024;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type TurnChangeObjectPutResult = { sha256: string; byteLength: number };

export type TurnChangeObjectStore = {
  put(bytes: Uint8Array): Promise<TurnChangeObjectPutResult>;
  get(sha256: string): Promise<Uint8Array>;
  stat(sha256: string): Promise<TurnChangeObjectPutResult | undefined>;
};

export function createTurnChangeObjectStore(options: {
  rootDir: string;
  maxObjectBytes?: number;
}): TurnChangeObjectStore {
  const maxObjectBytes = options.maxObjectBytes ?? DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES;
  const rootDir = options.rootDir;

  return {
    async put(bytes: Uint8Array): Promise<TurnChangeObjectPutResult> {
      if (bytes.byteLength > maxObjectBytes) {
        throw new Error(`object exceeds maxObjectBytes (${maxObjectBytes})`);
      }
      const sha256 = sha256Hex(bytes);
      const destination = objectPath(rootDir, sha256);
      const existing = await readExistingObject(destination);
      if (existing) {
        if (sha256Hex(existing) !== sha256) {
          throw new Error('corrupt-object');
        }
        return { sha256, byteLength: existing.byteLength };
      }
      await publishObject(rootDir, destination, bytes);
      return { sha256, byteLength: bytes.byteLength };
    },

    async get(sha256: string): Promise<Uint8Array> {
      const path = objectPath(rootDir, assertSha256(sha256));
      const bytes = await readFile(path).catch((error: unknown) => {
        if (isNotFound(error)) {
          throw new Error('object not found');
        }
        throw error;
      });
      const digest = sha256Hex(bytes);
      if (digest !== sha256) {
        throw new Error('corrupt-object');
      }
      return new Uint8Array(bytes);
    },

    async stat(sha256: string): Promise<TurnChangeObjectPutResult | undefined> {
      const path = objectPath(rootDir, assertSha256(sha256));
      try {
        const info = await stat(path);
        return { sha256, byteLength: info.size };
      } catch (error) {
        if (isNotFound(error)) {
          return undefined;
        }
        throw error;
      }
    },
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertSha256(sha256: string): string {
  if (!SHA256_HEX.test(sha256)) {
    throw new Error('invalid sha256');
  }
  return sha256;
}

function objectPath(rootDir: string, sha256: string): string {
  return join(rootDir, 'objects', sha256.slice(0, 2), sha256.slice(2));
}

async function readExistingObject(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function publishObject(
  rootDir: string,
  destination: string,
  bytes: Uint8Array,
): Promise<void> {
  const tempDir = join(rootDir, 'temp');
  await mkdir(tempDir, { recursive: true });
  await mkdir(dirname(destination), { recursive: true });
  const tempPath = join(tempDir, randomUUID());
  try {
    await writeTempObject(tempPath, bytes);
    await rename(tempPath, destination);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function writeTempObject(tempPath: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(tempPath, 'w', 0o600);
  try {
    await handle.writeFile(bytes);
    if (process.platform !== 'win32') {
      try {
        await handle.chmod(0o600);
      } catch {
        // chmod may be unsupported; mode was still set on create.
      }
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'ENOENT';
}

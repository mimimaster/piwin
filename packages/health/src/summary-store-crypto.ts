/**
 * At-rest encryption for the health summary snapshot: AES-256-GCM with a key
 * kept beside it, owner-only. This protects backups and accidental disclosure
 * of the file; it does not protect against someone who controls the Host.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const KEY_BYTES = 32;
const IV_BYTES = 12;

type Envelope = { v: 1; iv: string; tag: string; data: string };

export class HealthStoreKeyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'HealthStoreKeyError';
  }
}

/** Read the store key, creating it on first use. A damaged key is an error, never replaced. */
export async function loadOrCreateHealthStoreKey(keyPath: string): Promise<Buffer> {
  try {
    const key = Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'base64');
    if (key.length !== KEY_BYTES) {
      throw new HealthStoreKeyError('Health store key is damaged');
    }
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const key = randomBytes(KEY_BYTES);
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  await writeFile(keyPath, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(keyPath, 0o600);
  return key;
}

export function encryptHealthSnapshot(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: Envelope = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope);
}

export function decryptHealthSnapshot(serialized: string, key: Buffer): string {
  const envelope = JSON.parse(serialized) as Partial<Envelope>;
  if (
    envelope.v !== 1 ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    typeof envelope.data !== 'string'
  ) {
    throw new HealthStoreKeyError('Health store file is not a recognized snapshot');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

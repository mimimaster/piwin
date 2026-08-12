/**
 * One-shot binary bootstrap used for provider secrets.
 *
 * The regular worker protocol is JSONL on stdin/stdout. Raw provider keys
 * never enter that channel. Instead the parent writes one bounded,
 * length-prefixed frame to a dedicated inherited file descriptor and closes
 * it before the worker sends its hello frame.
 */

import { createReadStream } from 'node:fs';
import type { EphemeralProviderSecret } from '@piwin/contracts';

export const WORKER_SECRET_BOOTSTRAP_VERSION = 1 as const;
export const WORKER_SECRET_BOOTSTRAP_MAX_BYTES = 64 * 1024;
export const WORKER_SECRET_BOOTSTRAP_MAX_VALUE_BYTES = 16 * 1024;

type WorkerSecretBootstrapPayload = {
  version: typeof WORKER_SECRET_BOOTSTRAP_VERSION;
  secrets: EphemeralProviderSecret[];
};

/** Encode the one-shot bootstrap frame without emitting or storing diagnostics. */
export function encodeWorkerSecretBootstrap(secrets: readonly EphemeralProviderSecret[]): Buffer {
  validateSecretEntries(secrets);
  const payload: WorkerSecretBootstrapPayload = {
    version: WORKER_SECRET_BOOTSTRAP_VERSION,
    secrets: secrets.map((secret) => ({ secretId: secret.secretId, value: secret.value })),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8');
  if (encodedPayload.byteLength > WORKER_SECRET_BOOTSTRAP_MAX_BYTES) {
    throw new Error('worker secret bootstrap exceeds the maximum frame size');
  }
  const frame = Buffer.allocUnsafe(encodedPayload.byteLength + 4);
  frame.writeUInt32BE(encodedPayload.byteLength, 0);
  encodedPayload.copy(frame, 4);
  return frame;
}

/** Decode and validate a complete one-shot bootstrap frame. */
export function decodeWorkerSecretBootstrap(frame: Uint8Array): ReadonlyMap<string, string> {
  if (frame.byteLength < 4) {
    throw new Error('worker secret bootstrap frame is truncated');
  }
  const buffer = Buffer.from(frame);
  const payloadLength = buffer.readUInt32BE(0);
  if (
    payloadLength > WORKER_SECRET_BOOTSTRAP_MAX_BYTES ||
    payloadLength !== buffer.byteLength - 4
  ) {
    throw new Error('worker secret bootstrap frame length is invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.subarray(4).toString('utf8')) as unknown;
  } catch {
    throw new Error('worker secret bootstrap payload is invalid');
  }
  if (!isRecord(parsed) || parsed.version !== WORKER_SECRET_BOOTSTRAP_VERSION) {
    throw new Error('worker secret bootstrap version is unsupported');
  }
  const rawSecrets = parsed.secrets;
  if (!Array.isArray(rawSecrets)) {
    throw new Error('worker secret bootstrap secrets are invalid');
  }
  const secrets: EphemeralProviderSecret[] = [];
  for (const rawSecret of rawSecrets) {
    if (!isRecord(rawSecret)) {
      throw new Error('worker secret bootstrap entry is invalid');
    }
    const secretId = rawSecret.secretId;
    const value = rawSecret.value;
    if (typeof secretId !== 'string' || typeof value !== 'string') {
      throw new Error('worker secret bootstrap entry is invalid');
    }
    secrets.push({ secretId, value });
  }
  validateSecretEntries(secrets);
  return new Map(secrets.map((secret) => [secret.secretId, secret.value]));
}

/** Read exactly one bootstrap frame from the inherited file descriptor. */
export async function readWorkerSecretBootstrap(
  fileDescriptor = 3,
): Promise<ReadonlyMap<string, string>> {
  // Node ignores the path when an existing fd is supplied. The cast keeps the
  // runtime's documented `null` path form compatible with older @types/node.
  const stream = createReadStream(null as unknown as string, {
    fd: fileDescriptor,
    autoClose: true,
  });
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > WORKER_SECRET_BOOTSTRAP_MAX_BYTES + 4) {
      stream.destroy();
      throw new Error('worker secret bootstrap exceeds the maximum frame size');
    }
    chunks.push(buffer);
  }
  return decodeWorkerSecretBootstrap(Buffer.concat(chunks));
}

function validateSecretEntries(secrets: readonly EphemeralProviderSecret[]): void {
  const ids = new Set<string>();
  for (const secret of secrets) {
    const idBytes = Buffer.byteLength(secret.secretId, 'utf8');
    const valueBytes = Buffer.byteLength(secret.value, 'utf8');
    if (
      secret.secretId.trim().length === 0 ||
      idBytes > 256 ||
      valueBytes > WORKER_SECRET_BOOTSTRAP_MAX_VALUE_BYTES
    ) {
      throw new Error('worker secret bootstrap entry exceeds its limits');
    }
    if (ids.has(secret.secretId)) {
      throw new Error('worker secret bootstrap contains duplicate ids');
    }
    ids.add(secret.secretId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

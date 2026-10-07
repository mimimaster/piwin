/**
 * Narrow HTTP ingress for background health summaries (ADR 0062 M2). A phone
 * woken by HealthKit has no WebView and no WebSocket; it posts one bounded
 * batch with its pairing credential and leaves. This path never reaches a
 * model or a session, and never logs a health value.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  HealthSummarySyncPort,
  TrustedDeviceCredential,
  TrustedDevicePublic,
} from '@piwin/contracts';
import {
  HEALTH_SUMMARY_DELETE_PATH,
  HEALTH_SUMMARY_DEVICE_ID_HEADER,
  HEALTH_SUMMARY_MAX_BATCH_BYTES,
  HEALTH_SUMMARY_SYNC_PATH,
  parseHealthSummarySyncBatch,
} from '@piwin/contracts';

export type DeviceHealthHttpContext = {
  /** Paired-device check; undefined when this Host has no pairing authority. */
  authenticate: ((credential: TrustedDeviceCredential) => TrustedDevicePublic | undefined) | undefined;
  sync: HealthSummarySyncPort | undefined;
};

const DRAIN_LIMIT_FACTOR = 8;

/** One upload at a time per device; a second one is told to retry. */
const syncingDevices = new Set<string>();

export function isDeviceHealthRequest(request: IncomingMessage): boolean {
  const path = requestPath(request);
  return path === HEALTH_SUMMARY_SYNC_PATH || path === HEALTH_SUMMARY_DELETE_PATH;
}

export async function handleDeviceHealthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: DeviceHealthHttpContext,
): Promise<void> {
  const path = requestPath(request);
  const expectedMethod = path === HEALTH_SUMMARY_SYNC_PATH ? 'POST' : 'DELETE';
  if (request.method !== expectedMethod) {
    response.setHeader('Allow', expectedMethod);
    return reply(response, 405, 'method-not-allowed');
  }
  const deviceId = authenticateRequest(request, context);
  if (deviceId === undefined) {
    return reply(response, 401, 'unauthorized');
  }
  const sync = context.sync;
  if (sync === undefined) {
    return reply(response, 403, 'storage-disabled');
  }
  if (expectedMethod === 'DELETE') {
    await sync.deleteDevice(deviceId);
    return reply(response, 200, 'deleted');
  }
  if (!(await sync.isStorageEnabled())) {
    return reply(response, 403, 'storage-disabled');
  }
  if (syncingDevices.has(deviceId)) {
    return reply(response, 429, 'sync-in-progress');
  }
  syncingDevices.add(deviceId);
  try {
    const body = await readBoundedBody(request);
    if (body === 'too-large') {
      return reply(response, 413, 'batch-too-large');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return reply(response, 400, 'invalid-json');
    }
    const batch = parseHealthSummarySyncBatch(payload);
    if (!batch.ok) {
      return reply(response, 400, 'invalid-batch');
    }
    const result = await sync.sync(deviceId, batch.value);
    return reply(response, 200, 'synced', result);
  } finally {
    syncingDevices.delete(deviceId);
  }
}

function authenticateRequest(
  request: IncomingMessage,
  context: DeviceHealthHttpContext,
): string | undefined {
  const deviceId = request.headers[HEALTH_SUMMARY_DEVICE_ID_HEADER];
  const authorization = request.headers.authorization;
  if (
    context.authenticate === undefined ||
    typeof deviceId !== 'string' ||
    typeof authorization !== 'string' ||
    !authorization.startsWith('Bearer ')
  ) {
    return undefined;
  }
  const deviceSecret = authorization.slice('Bearer '.length).trim();
  if (deviceId.length === 0 || deviceSecret.length === 0) {
    return undefined;
  }
  return context.authenticate({ deviceId, deviceSecret })?.id;
}

/**
 * Reads at most the batch cap into memory. An oversized body is drained
 * without being kept so the caller still receives its 413, up to a hard stop
 * after which the connection is dropped.
 */
async function readBoundedBody(request: IncomingMessage): Promise<string | 'too-large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > HEALTH_SUMMARY_MAX_BATCH_BYTES * DRAIN_LIMIT_FACTOR) {
      request.destroy();
      return 'too-large';
    }
    if (size <= HEALTH_SUMMARY_MAX_BATCH_BYTES) {
      chunks.push(bytes);
    }
  }
  return size > HEALTH_SUMMARY_MAX_BATCH_BYTES ? 'too-large' : Buffer.concat(chunks).toString('utf8');
}

function reply(
  response: ServerResponse,
  statusCode: number,
  status: string,
  data?: Record<string, unknown>,
): void {
  response
    .writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    .end(JSON.stringify({ status, ...data }));
}

function requestPath(request: IncomingMessage): string {
  return (request.url ?? '/').split('?')[0] ?? '/';
}

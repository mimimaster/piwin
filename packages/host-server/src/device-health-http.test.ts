import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  HealthSummarySyncBatchV1,
  HealthSummarySyncPort,
  TrustedDevicePublic,
} from '@piwin/contracts';
import {
  HEALTH_SUMMARY_DELETE_PATH,
  HEALTH_SUMMARY_MAX_BATCH_BYTES,
  HEALTH_SUMMARY_SYNC_PATH,
} from '@piwin/contracts';
import { handleDeviceHealthRequest, isDeviceHealthRequest } from './device-health-http.js';

const servers: Server[] = [];

type Harness = {
  url: string;
  synced: Array<{ deviceId: string; batch: HealthSummarySyncBatchV1 }>;
  deleted: string[];
};

async function startHarness(options: { storageEnabled?: boolean; withSync?: boolean } = {}): Promise<Harness> {
  const synced: Harness['synced'] = [];
  const deleted: string[] = [];
  const sync: HealthSummarySyncPort = {
    isStorageEnabled: async () => options.storageEnabled !== false,
    sync: async (deviceId, batch) => {
      synced.push({ deviceId, batch });
      return { applied: true, storedRecords: batch.records.length };
    },
    deleteDevice: async (deviceId) => {
      deleted.push(deviceId);
    },
  };
  const server = createServer((request, response) => {
    if (!isDeviceHealthRequest(request)) {
      response.writeHead(404).end();
      return;
    }
    void handleDeviceHealthRequest(request, response, {
      authenticate: (credential) =>
        credential.deviceId === 'device-a' && credential.deviceSecret === 'secret-a'
          ? ({ id: 'device-a', name: 'iPhone' } as TrustedDevicePublic)
          : undefined,
      sync: options.withSync === false ? undefined : sync,
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, synced, deleted };
}

const AUTH = { 'X-Piwin-Device-Id': 'device-a', Authorization: 'Bearer secret-a' };

function batch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    batchId: 'batch-1',
    generatedAt: '2026-10-07T04:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    startDate: '2026-10-06',
    endDateExclusive: '2026-10-08',
    metrics: ['steps'],
    records: [
      { metric: 'steps', localDate: '2026-10-07', unit: 'count', value: 1200, freshAsOf: '2026-10-07T04:00:00.000Z' },
    ],
    ...overrides,
  };
}

function post(harness: Harness, body: unknown, headers: Record<string, string> = AUTH): Promise<Response> {
  return fetch(`${harness.url}${HEALTH_SUMMARY_SYNC_PATH}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('device health HTTP ingress', () => {
  it('stores a batch under the authenticated device, never one named in the body', async () => {
    const harness = await startHarness();
    const response = await post(harness, batch());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'synced', applied: true, storedRecords: 1 });
    expect(harness.synced).toHaveLength(1);
    expect(harness.synced[0]?.deviceId).toBe('device-a');

    const spoofed = await post(harness, batch({ deviceId: 'device-b' }));
    expect(spoofed.status).toBe(400);
    expect(harness.synced).toHaveLength(1);
  });

  it('refuses unpaired callers and wrong secrets without reading the body', async () => {
    const harness = await startHarness();
    expect((await post(harness, batch(), {})).status).toBe(401);
    expect(
      (await post(harness, batch(), { 'X-Piwin-Device-Id': 'device-a', Authorization: 'Bearer nope' })).status,
    ).toBe(401);
    expect(harness.synced).toHaveLength(0);
  });

  it('refuses to store anything while storage is off', async () => {
    const off = await startHarness({ storageEnabled: false });
    const response = await post(off, batch());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: 'storage-disabled' });
    expect(off.synced).toHaveLength(0);
    expect((await post(await startHarness({ withSync: false }), batch())).status).toBe(403);
  });

  it('rejects malformed, hourly and oversized batches', async () => {
    const harness = await startHarness();
    expect((await post(harness, '{not json')).status).toBe(400);
    expect(
      (
        await post(
          harness,
          batch({
            records: [
              { metric: 'steps', localDate: '2026-10-07', localHour: 9, unit: 'count', value: 5, freshAsOf: '2026-10-07T04:00:00.000Z' },
            ],
          }),
        )
      ).status,
    ).toBe(400);
    expect((await post(harness, 'x'.repeat(HEALTH_SUMMARY_MAX_BATCH_BYTES + 1))).status).toBe(413);
    expect(harness.synced).toHaveLength(0);
  });

  it('deletes only the calling device and only by DELETE', async () => {
    const harness = await startHarness();
    const wrongMethod = await fetch(`${harness.url}${HEALTH_SUMMARY_DELETE_PATH}`, { method: 'POST', headers: AUTH });
    expect(wrongMethod.status).toBe(405);
    const response = await fetch(`${harness.url}${HEALTH_SUMMARY_DELETE_PATH}`, { method: 'DELETE', headers: AUTH });
    expect(response.status).toBe(200);
    expect(harness.deleted).toEqual(['device-a']);
  });
});

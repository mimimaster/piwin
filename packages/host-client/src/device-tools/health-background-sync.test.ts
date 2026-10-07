import { describe, expect, it } from 'vitest';
import { APPLE_HEALTH_METRIC_IDS } from '@piwin/contracts';
import { createHealthBackgroundSyncBridge, healthSummarySyncUrl } from './health-background-sync.js';

describe('healthSummarySyncUrl', () => {
  it('maps the paired WebSocket origin to the HTTP sync endpoint', () => {
    expect(healthSummarySyncUrl('ws://192.168.1.20:8787')).toBe(
      'http://192.168.1.20:8787/v1/device-health/summaries:sync',
    );
    expect(healthSummarySyncUrl(' wss://host.example.ts.net/ws?x=1 ')).toBe(
      'https://host.example.ts.net/v1/device-health/summaries:sync',
    );
  });

  it('refuses addresses that are not a plain WebSocket endpoint', () => {
    expect(healthSummarySyncUrl('http://192.168.1.20:8787')).toBeUndefined();
    expect(healthSummarySyncUrl('ws://user:secret@host:8787')).toBeUndefined();
    expect(healthSummarySyncUrl('not a url')).toBeUndefined();
  });
});

describe('health background sync bridge', () => {
  it('hands the native layer the sync URL, the credential and every metric', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const bridge = createHealthBackgroundSyncBridge(async (command, args) => {
      calls.push(args === undefined ? { command } : { command, args });
      return { enabled: true, lastSyncAt: '2026-10-07T04:00:00.000Z' };
    });
    const status = await bridge.enable('ws://192.168.1.20:8787', {
      deviceId: 'device-a',
      deviceSecret: 'secret-a',
    });
    expect(status).toEqual({ enabled: true, lastSyncAt: '2026-10-07T04:00:00.000Z' });
    expect(calls[0]).toEqual({
      command: 'plugin:piwin-healthkit|healthkit_background_sync_configure',
      args: {
        config: {
          syncUrl: 'http://192.168.1.20:8787/v1/device-health/summaries:sync',
          deviceId: 'device-a',
          deviceSecret: 'secret-a',
          metrics: [...APPLE_HEALTH_METRIC_IDS],
        },
      },
    });
  });

  it('clears the native credential on disable and reports off when the plugin is missing', async () => {
    const calls: unknown[] = [];
    const bridge = createHealthBackgroundSyncBridge(async (command, args) => {
      calls.push(args);
      if (command.endsWith('status')) {
        throw new Error('plugin not found');
      }
      return { enabled: false };
    });
    await bridge.disable();
    expect(calls[0]).toEqual({ config: null });
    expect(await bridge.status()).toEqual({ enabled: false });
  });
});

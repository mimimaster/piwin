import { describe, expect, it } from 'vitest';
import type { HostCommand } from './ipc.js';
import {
  isLocalMobileAccessCommand,
  isLocalMobileAccessCommandType,
  projectPairedDeviceSummary,
  readMobileAccessDeviceListData,
  readMobileAccessPairingCodeData,
  readMobileAccessStatusData,
} from './mobile-access.js';

describe('LocalMobileAccessCommand', () => {
  it('accepts the sidecar command shapes and rejects HostCommand lookalikes', () => {
    expect(isLocalMobileAccessCommand({ type: 'mobile-access/status' })).toBe(true);
    expect(
      isLocalMobileAccessCommand({
        type: 'mobile-access/start',
        profileId: 'loopback',
        advertisedEndpoint: 'wss://mac.tailnet.ts.net:8787',
      }),
    ).toBe(true);
    expect(isLocalMobileAccessCommand({ type: 'mobile-access/revoke-device', deviceId: 'device-1' })).toBe(
      true,
    );
    expect(isLocalMobileAccessCommand({ type: 'mobile-access/start' })).toBe(false);
    expect(isLocalMobileAccessCommand({ type: 'mobile-access/revoke-device', deviceId: '' })).toBe(false);
    expect(isLocalMobileAccessCommand({ type: 'host/status' })).toBe(false);
    expect(isLocalMobileAccessCommandType('secrets/get')).toBe(false);

    const hostCommand: HostCommand = { type: 'host/status' };
    expect(hostCommand.type).not.toBe('mobile-access/status');
  });

  it('projects paired devices without secret hashes', () => {
    const summary = projectPairedDeviceSummary({
      id: 'device-1',
      name: 'iPhone',
      createdAt: '2026-08-18T00:00:00.000Z',
      lastSeenAt: '2026-08-18T00:01:00.000Z',
      revokedAt: '2026-08-18T00:02:00.000Z',
    });
    expect(summary).toEqual({
      id: 'device-1',
      name: 'iPhone',
      createdAt: '2026-08-18T00:00:00.000Z',
      lastSeenAt: '2026-08-18T00:01:00.000Z',
      revoked: true,
    });
    expect(JSON.stringify(summary)).not.toContain('secretHash');
  });

  it('reads status, pairing-code, and device-list payloads', () => {
    expect(
      readMobileAccessStatusData({
        listening: true,
        pairedDeviceCount: 1,
        profileId: 'loopback',
        bindHost: '127.0.0.1',
        bindPort: 8787,
        bindUrl: 'ws://127.0.0.1:8787',
        advertisedEndpoint: 'wss://mac.example:8787',
        hostInstanceId: 'cli-1',
        secretHash: 'must-drop',
      }),
    ).toEqual({
      listening: true,
      pairedDeviceCount: 1,
      profileId: 'loopback',
      bindHost: '127.0.0.1',
      bindPort: 8787,
      bindUrl: 'ws://127.0.0.1:8787',
      advertisedEndpoint: 'wss://mac.example:8787',
      hostInstanceId: 'cli-1',
    });

    expect(
      readMobileAccessPairingCodeData({
        endpoint: 'ws://127.0.0.1:8787',
        pairingToken: 'token',
        hostInstanceId: 'cli-1',
        protocolVersion: 1,
        expiresAt: 1,
        uri: 'piwin://pair?endpoint=ws://127.0.0.1:8787',
      }),
    ).toMatchObject({
      endpoint: 'ws://127.0.0.1:8787',
      uri: 'piwin://pair?endpoint=ws://127.0.0.1:8787',
    });

    expect(
      readMobileAccessDeviceListData({
        devices: [
          {
            id: 'device-1',
            name: 'iPhone',
            createdAt: 't0',
            lastSeenAt: 't1',
            revoked: false,
            secretHash: 'must-drop',
          },
        ],
      }),
    ).toEqual({
      devices: [
        {
          id: 'device-1',
          name: 'iPhone',
          createdAt: 't0',
          lastSeenAt: 't1',
          revoked: false,
        },
      ],
    });
  });
});

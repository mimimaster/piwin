import { describe, expect, it } from 'vitest';
import type { HostHydrationFrame, HostPushBatchFrame, HostServerMessage } from './index.js';
import {
  FALLBACK_REMOTE_ALLOWED_COMMANDS,
  remoteHostSupportsCommand,
} from './remote-protocol.js';

describe('Host cursor batch contracts', () => {
  it('keeps a batch as a HostServerMessage without changing singular push shapes', () => {
    const frame: HostPushBatchFrame = {
      type: 'push/batch',
      hostInstanceId: 'host-1',
      afterSeq: 4,
      throughSeq: 7,
      items: [
        {
          seq: 5,
          eventId: 'event-5',
          push: { type: 'host/status', mode: 'sdk', ready: true, mock: false },
        },
        {
          seq: 7,
          eventId: 'event-7',
          push: { type: 'host/log', level: 'info', message: 'ready' },
        },
      ],
    };

    const message: HostServerMessage = frame;
    expect(message.type).toBe('push/batch');
    expect(frame.items.map((item) => item.seq)).toEqual([5, 7]);
  });

  it('keeps hydration as an additive HostServerMessage frame', () => {
    const frame: HostHydrationFrame = {
      type: 'hydration',
      reason: 'host-instance-changed',
      snapshot: {
        snapshotId: 'snapshot-1',
        hostInstanceId: 'host-2',
        snapshotSeq: 0,
        status: {
          hostInstanceId: 'host-2',
          protocolVersion: 1,
          mode: 'rpc',
          ready: false,
          mock: false,
          activeSessionCount: 0,
          capabilities: {
            pushSequencing: true,
            replay: true,
            snapshot: true,
            sessionRead: true,
            sessionControl: false,
            permissionResolve: false,
            mediaUpload: false,
          },
        },
        sessions: [],
        messagesBySession: {},
        truncatedSessionIds: [],
      },
    };

    const message: HostServerMessage = frame;
    expect(message.type).toBe('hydration');
  });
});

describe('remoteHostSupportsCommand', () => {
  it('treats an omitted ceiling as the operator', () => {
    expect(remoteHostSupportsCommand(undefined, 'host/status')).toBe(true);
    expect(remoteHostSupportsCommand(undefined, 'models/configured')).toBe(true);
    expect(remoteHostSupportsCommand(undefined, 'settings/get')).toBe(true);
    expect(remoteHostSupportsCommand(undefined, 'settings/apply')).toBe(true);
    expect(remoteHostSupportsCommand(undefined, 'plan/get')).toBe(true);
    expect(remoteHostSupportsCommand(undefined, 'pet/list')).toBe(true);
    expect(remoteHostSupportsCommand(undefined, 'theme/get-active')).toBe(true);
  });

  it('keeps Host settings mutations on the historical fallback ceiling', () => {
    expect(FALLBACK_REMOTE_ALLOWED_COMMANDS).toEqual(
      expect.arrayContaining([
        'models/discover',
        'models/test',
        'models/image-test',
        'secrets/set',
        'secrets/get',
        'settings/get',
        'settings/apply',
      ]),
    );
  });

  it('trusts the advertised ceiling when present', () => {
    expect(remoteHostSupportsCommand(['host/ping', 'settings/get'], 'settings/get')).toBe(true);
    expect(remoteHostSupportsCommand(['host/ping'], 'host/status')).toBe(false);
  });
});

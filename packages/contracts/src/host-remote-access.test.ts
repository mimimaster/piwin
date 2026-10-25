import { describe, expect, it } from 'vitest';
import {
  isHostRemoteAccessCommand,
  isHostRemoteAccessCommandType,
  isLegacyAccessMode,
} from './host-remote-access.js';
import { isHostPairingCommand, readHostPairingStatusData } from './host-pairing.js';
import { decodeRelayControlFrame } from './remote-channel.js';
import { projectPairedDeviceSummary, readMobileAccessDeviceListData } from './mobile-access.js';

describe('host remote access commands', () => {
  it('recognizes every command type and nothing else', () => {
    expect(isHostRemoteAccessCommandType('host/channel-migrate')).toBe(true);
    expect(isHostRemoteAccessCommandType('host/pairing-status')).toBe(false);
  });

  it.each([
    [{ type: 'host/remote-access-configure', relay: { enabled: true, url: 'wss://r.example' } }],
    [{ type: 'host/remote-access-configure', relay: { url: null, enrollToken: null } }],
    [{ type: 'host/remote-access-configure', legacyAccess: 'migrate-only' }],
    [{ type: 'host/relay-user-create', name: 'Yorick' }],
    [{ type: 'host/relay-user-rename', name: 'Y' }],
    [{ type: 'host/relay-user-export', passphrase: 'correct horse' }],
    [{ type: 'host/relay-user-import', bundle: 'piwin-user-bundle:v1:x', passphrase: 'p' }],
    [{ type: 'host/relay-user-enrollment-line' }],
    [{ type: 'host/channel-migrate', channelPublicKey: 'k', clientId: 'c', deviceName: 'Phone' }],
  ])('accepts %o', (command) => {
    expect(isHostRemoteAccessCommand(command)).toBe(true);
  });

  it.each([
    [{ type: 'host/remote-access-configure' }],
    [{ type: 'host/remote-access-configure', legacyAccess: 'sometimes' }],
    [{ type: 'host/remote-access-configure', relay: { enabled: 'yes' } }],
    [{ type: 'host/remote-access-configure', relay: { url: 42 } }],
    [{ type: 'host/relay-user-create', name: '   ' }],
    [{ type: 'host/relay-user-export' }],
    [{ type: 'host/relay-user-import', bundle: 'b' }],
    [{ type: 'host/channel-migrate', channelPublicKey: 'k' }],
    [{ type: 'host/channel-migrate', channelPublicKey: 'x'.repeat(65), clientId: 'c' }],
    [{ type: 'host/unknown' }],
    [null],
  ])('rejects %o', (command) => {
    expect(isHostRemoteAccessCommand(command)).toBe(false);
  });

  it('validates legacy access modes', () => {
    expect(['full', 'migrate-only', 'off'].every(isLegacyAccessMode)).toBe(true);
    expect(isLegacyAccessMode('on')).toBe(false);
  });

  it('accepts a pairing-code role and rejects an unknown one', () => {
    expect(isHostPairingCommand({ type: 'host/pairing-create-code', role: 'operator' })).toBe(true);
    expect(isHostPairingCommand({ type: 'host/pairing-create-code', role: 'admin' })).toBe(false);
  });
});

describe('relay peer-close frame', () => {
  it('decodes a valid frame and rejects codes outside 4000–4999', () => {
    expect(
      decodeRelayControlFrame('{"t":"peer-close","peer":3,"code":4004,"reason":"revoked"}'),
    ).toEqual({ t: 'peer-close', peer: 3, code: 4004, reason: 'revoked' });
    for (const text of [
      '{"t":"peer-close","peer":3,"code":1000}',
      '{"t":"peer-close","peer":0,"code":4004}',
      '{"t":"peer-close","peer":3,"code":4004.5}',
      `{"t":"peer-close","peer":3,"code":4004,"reason":"${'x'.repeat(121)}"}`,
    ]) {
      expect(decodeRelayControlFrame(text)).toBeUndefined();
    }
  });
});

describe('paired device summary', () => {
  it('reports role, channel binding and migration time', () => {
    const summary = projectPairedDeviceSummary({
      id: 'd',
      name: 'Phone',
      createdAt: 't0',
      lastSeenAt: 't1',
      role: 'operator',
      channelPublicKey: 'key',
      migratedAt: 't2',
    });
    expect(summary).toEqual({
      id: 'd',
      name: 'Phone',
      createdAt: 't0',
      lastSeenAt: 't1',
      revoked: false,
      role: 'operator',
      secureChannel: true,
      migratedAt: 't2',
    });
    expect(readMobileAccessDeviceListData({ devices: [summary] })?.devices[0]).toEqual(summary);
    expect(
      projectPairedDeviceSummary({ id: 'd', name: 'n', createdAt: 'a', lastSeenAt: 'b' }),
    ).not.toHaveProperty('secureChannel');
  });
});

describe('pairing status remote block', () => {
  const remote = {
    hostId: 'ZyXwVuTsRqPoNmLkJiHg-_',
    hostName: 'Server',
    user: { userId: 'AbCdEfGhIjKlMnOpQrSt_-', name: 'owner' },
    relay: { enabled: true, url: 'wss://relay.example.com', state: 'error', lastCloseCode: 4401 },
    direct: { enabled: true, url: 'ws://10.0.0.2:8790' },
    legacyAccess: 'migrate-only',
  };
  const base = { enabled: true, canManage: true, pairedDeviceCount: 1, hostInstanceId: 'h' };

  it('keeps a valid remote block', () => {
    expect(readHostPairingStatusData({ ...base, remote })?.remote).toEqual(remote);
  });

  it('drops a malformed one without losing the rest of the status', () => {
    const status = readHostPairingStatusData({ ...base, remote: { ...remote, legacyAccess: 'x' } });
    expect(status).toMatchObject(base);
    expect(status).not.toHaveProperty('remote');
  });
});

describe('local phone-access data carries ADR 0101 fields', () => {
  it('keeps v3 links on pairing codes and the role on create-code', async () => {
    const { readMobileAccessPairingCodeData, isLocalMobileAccessCommand } =
      await import('./mobile-access.js');
    const code = {
      endpoint: 'ws://10.0.0.2:8790',
      pairingToken: 't',
      hostInstanceId: 'h',
      protocolVersion: 1,
      expiresAt: 1,
      uri: 'piwin://pair?x',
      channelUri: 'piwin://pair?v=3&x',
      webUri: 'https://relay.example.com/#pair=x',
    };
    expect(readMobileAccessPairingCodeData(code)).toEqual(code);
    expect(
      isLocalMobileAccessCommand({ type: 'mobile-access/create-pairing-code', role: 'operator' }),
    ).toBe(true);
    expect(
      isLocalMobileAccessCommand({ type: 'mobile-access/create-pairing-code', role: 'root' }),
    ).toBe(false);
  });
});

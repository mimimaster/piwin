import type { ChannelMigrateResult, HostRemoteAccessCommand, HostResponse } from '@piwin/contracts';
import { isHostRemoteAccessCommand } from '@piwin/contracts';
import { deviceRoleOf, type HostDevicePairing } from './device-pairing.js';
import type { HostDevicePairingFileStore } from './device-pairing-store.js';
import type { HostClientConnection } from './host-client-connection.js';
import type { HostRemoteAccess } from './host-remote-access.js';

export type HostRemoteAccessCommandContext = {
  access: HostRemoteAccess | undefined;
  pairing: HostDevicePairing | undefined;
  pairingStore: HostDevicePairingFileStore | undefined;
  connection: Pick<
    HostClientConnection,
    'admittedBy' | 'channelPublicKey' | 'deviceId' | 'deviceRole'
  >;
};

export const REMOTE_ACCESS_UNAVAILABLE_ERROR = 'This Host has no ADR 0101 remote access configured';
export const REMOTE_ACCESS_FORBIDDEN_ERROR = 'Only an operator can manage remote access';

/**
 * `host/remote-access-*`, `host/relay-user-*` and `host/channel-migrate`
 * (ADR 0101). Answered by the Host server, never by HostRuntime.
 */
export async function handleHostRemoteAccessCommand(
  command: HostRemoteAccessCommand,
  context: HostRemoteAccessCommandContext,
): Promise<HostResponse> {
  const respond = (result: { data: unknown } | { error: string }): HostResponse => ({
    type: 'response',
    command: command.type,
    ...('error' in result
      ? { success: false as const, error: result.error }
      : { success: true as const, data: result.data }),
    ...(command.id === undefined ? {} : { id: command.id }),
  });
  if (!isHostRemoteAccessCommand(command)) {
    return respond({ error: `Invalid ${String((command as { type?: unknown }).type)} payload` });
  }
  const access = context.access;
  if (access === undefined) {
    return respond({ error: REMOTE_ACCESS_UNAVAILABLE_ERROR });
  }
  try {
    if (command.type === 'host/channel-migrate') {
      return respond({ data: await migrate(command, access, context) });
    }
    if (!isOperator(context.connection)) {
      return respond({ error: REMOTE_ACCESS_FORBIDDEN_ERROR });
    }
    switch (command.type) {
      case 'host/remote-access-configure':
        return respond({ data: await access.configure(command) });
      case 'host/relay-user-create':
        return respond({ data: await access.createUser(command.name) });
      case 'host/relay-user-rename':
        return respond({ data: await access.renameUser(command.name) });
      case 'host/relay-user-export':
        return respond({ data: { bundle: await access.exportUser(command.passphrase) } });
      case 'host/relay-user-import':
        return respond({ data: await access.importUser(command.bundle, command.passphrase) });
      case 'host/relay-user-enrollment-line':
        return respond({ data: { line: await access.enrollmentLine() } });
    }
  } catch (error) {
    return respond({
      error: error instanceof Error ? error.message : 'Remote access command failed',
    });
  }
}

/** Loopback, token door, or a device paired as `operator`. */
export function isOperator(
  connection: Pick<HostClientConnection, 'deviceId' | 'deviceRole'>,
): boolean {
  return connection.deviceId === undefined || connection.deviceRole === 'operator';
}

/**
 * ADR 0101 §10. Runs on the legacy path only: a device-credential caller binds
 * its new key to its own record; a token-door caller becomes an operator
 * device and receives its credential once.
 */
async function migrate(
  command: Extract<HostRemoteAccessCommand, { type: 'host/channel-migrate' }>,
  access: HostRemoteAccess,
  context: HostRemoteAccessCommandContext,
): Promise<ChannelMigrateResult> {
  const { connection, pairing } = context;
  if (connection.channelPublicKey !== undefined) {
    throw new Error('Already on the encrypted channel');
  }
  if (pairing === undefined) {
    throw new Error('Device pairing is not enabled on this Host');
  }
  const target = access.migrationTarget();
  if (connection.admittedBy === 'device' && connection.deviceId !== undefined) {
    const result = pairing.bindChannelKey(connection.deviceId, command.channelPublicKey);
    if (result === 'conflict') {
      throw new Error('This device already migrated with another key; revoke and re-pair it');
    }
    if (result === 'unknown') {
      throw new Error('This device is no longer paired');
    }
    await context.pairingStore?.save(pairing);
    return { ...target, role: connection.deviceRole ?? 'member' };
  }
  if (connection.admittedBy === 'token') {
    const completion = pairing.enrollMigratedOperator({
      clientId: command.clientId,
      channelPublicKey: command.channelPublicKey,
      ...(command.deviceName === undefined ? {} : { deviceName: command.deviceName }),
    });
    await context.pairingStore?.save(pairing);
    return { ...target, credential: completion.credential, role: deviceRoleOf(completion.device) };
  }
  throw new Error('Only paired devices and token connections migrate');
}

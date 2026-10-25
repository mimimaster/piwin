import type {
  ChannelMigrateResult,
  HostBookEntry,
  HostClientHello,
  HostCommand,
  HostHello,
  HostResponse,
  TrustedDeviceCredential,
} from '@piwin/contracts';
import {
  encodeBase64Url,
  WebSocketHostTransport,
  type WebSocketFactory,
} from '@piwin/host-transport';
import type { HostBook } from './host-book.js';
import { RemoteHostVault, type RemoteHostSecrets } from './remote-host-vault.js';

/** A pre-ADR 0101 attach target a shell still remembers. */
export type LegacyHostRecord = {
  endpoint: string;
  /** Exactly one of the two. */
  credential?: TrustedDeviceCredential;
  authToken?: string;
  clientId: string;
  deviceName?: string;
};

export type LegacyHostConnection = {
  hello: HostHello;
  request: (command: HostCommand) => Promise<HostResponse>;
  close: () => Promise<void>;
};

export type LegacyMigrationOutcome =
  /** Host book entry written and verified; the caller deletes the legacy record. */
  | { status: 'migrated'; entry: HostBookEntry }
  /** The Host predates ADR 0101 (no endpoints on hello); keep the legacy record, retry later. */
  | { status: 'unsupported' }
  /** Something failed; nothing new was kept and the legacy record stays. */
  | { status: 'failed'; error: Error };

/**
 * ADR 0101 §10 client migrator: one last legacy connection runs
 * `host/channel-migrate` with a fresh client key, the result becomes a host
 * book entry plus vault secrets, and a hello over the new channel must
 * succeed before the caller may delete the legacy record.
 */
export async function migrateLegacyHost(input: {
  record: LegacyHostRecord;
  hostBook: HostBook;
  vault: RemoteHostVault;
  connectLegacy: (record: LegacyHostRecord) => Promise<LegacyHostConnection>;
  verifyChannel: (entry: HostBookEntry, secrets: RemoteHostSecrets) => Promise<void>;
  now?: () => Date;
}): Promise<LegacyMigrationOutcome> {
  let connection: LegacyHostConnection | undefined;
  let written: string | undefined;
  try {
    connection = await input.connectLegacy(input.record);
    if (connection.hello.endpoints === undefined) {
      return { status: 'unsupported' };
    }
    const clientKeyPair = RemoteHostVault.generateClientKeyPair();
    const response = await connection.request({
      type: 'host/channel-migrate',
      channelPublicKey: encodeBase64Url(clientKeyPair.publicKey),
      clientId: input.record.clientId,
      ...(input.record.deviceName === undefined ? {} : { deviceName: input.record.deviceName }),
    });
    if (!response.success) {
      throw new Error(response.error);
    }
    const result = response.data as ChannelMigrateResult;
    const credential = result.credential ?? input.record.credential;
    if (credential === undefined) {
      throw new Error('Migration returned no credential to keep');
    }
    const entry: HostBookEntry = {
      userId: result.userId,
      userName: result.userName,
      hostId: result.hostId,
      hostName: result.hostName,
      hostKey: result.hostKey,
      ...(result.relayUrl === undefined ? {} : { relayUrl: result.relayUrl }),
      ...(result.directUrl === undefined ? {} : { directUrl: result.directUrl }),
      role: result.role,
      pairedAt: (input.now?.() ?? new Date()).toISOString(),
    };
    const secrets: RemoteHostSecrets = { clientKeyPair, credential };
    written = entry.hostId;
    await input.vault.write(entry.hostId, secrets);
    const stored = await input.hostBook.upsert(entry);
    await input.verifyChannel(stored, secrets);
    return { status: 'migrated', entry: stored };
  } catch (error) {
    if (written !== undefined) {
      await input.hostBook.remove(written).catch(() => undefined);
      await input.vault.clear(written).catch(() => undefined);
    }
    return { status: 'failed', error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    await connection?.close().catch(() => undefined);
  }
}

let migrationRequests = 0;

/** Default legacy connection: the old cleartext hello over a plain WebSocket. */
export function createLegacyConnector(
  hello: Omit<
    HostClientHello,
    'pairingToken' | 'deviceCredential' | 'authToken' | 'lastSeq' | 'clientId'
  >,
  webSocketFactory?: WebSocketFactory,
): (record: LegacyHostRecord) => Promise<LegacyHostConnection> {
  return async (record) => {
    const transport = new WebSocketHostTransport({
      endpoint: record.endpoint,
      autoReconnect: false,
      ...(webSocketFactory === undefined ? {} : { webSocketFactory }),
      createHello: (lastSeq) => ({
        ...hello,
        clientId: record.clientId,
        lastSeq,
        ...(record.credential === undefined ? {} : { deviceCredential: record.credential }),
        ...(record.authToken === undefined ? {} : { authToken: record.authToken }),
      }),
    });
    const hostHello = await transport.connect();
    return {
      hello: hostHello,
      close: () => transport.close(),
      request: (command) =>
        new Promise<HostResponse>((resolve, reject) => {
          const requestId = `migrate-${(migrationRequests += 1)}`;
          const unsubscribe = transport.subscribe((message) => {
            if (message.type === 'response' && message.requestId === requestId) {
              unsubscribe();
              resolve(message.response);
            } else if (message.type === 'error' && message.requestId === requestId) {
              unsubscribe();
              reject(new Error(message.message));
            }
          });
          transport.send({ type: 'command', requestId, command });
        }),
    };
  };
}

import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import type {
  ChannelMigrateResult,
  HostRemoteAccessCommand,
  LegacyAccessMode,
  RemoteAccessStatusData,
} from '@piwin/contracts';
import {
  encodePairingLinkV3,
  encodePairingWebLink,
  normalizeRemoteDisplayName,
} from '@piwin/host-transport';
import type { WebSocket } from 'ws';
import type { ChannelPeerSession } from './channel-peer-session.js';
import type { HostDevicePairing } from './device-pairing.js';
import { createDirectChannelUpgradeHandler } from './direct-channel-endpoint.js';
import { HostIdentityStore, type HostIdentity } from './host-identity-store.js';
import type { HostChannelUpgradeHandler } from './host-server-listener.js';
import type { PairingChannelLinks } from './pairing-operations.js';
import { RelayConnector, type RelayConnectorStatus } from './relay-connector.js';
import { RelayUserStore, type HostRelayUser } from './relay-user-store.js';
import {
  normalizeRelayUrl,
  RemoteAccessSettingsStore,
  type RemoteAccessSettings,
} from './remote-access-settings-store.js';

export type HostRemoteAccessOptions = {
  identityStore: HostIdentityStore;
  userStore: RelayUserStore;
  settingsStore: RemoteAccessSettingsStore;
  pairing: HostDevicePairing;
  hostName?: string;
  /** Name for the relay user created on first start. */
  defaultUserName?: string;
  onError?: (error: Error) => void;
  /** Test seam for the relay socket. */
  createRelaySocket?: (url: string) => WebSocket;
  relayBackoffMs?: { min: number; max: number };
};

type MigrationTarget = Omit<ChannelMigrateResult, 'credential' | 'role'>;

/**
 * ADR 0101 remote access for one Host: identity, relay user, settings, the
 * relay connector and the direct channel route. HostServer talks to it for
 * admission (early drop, legacy mode), pairing links, status and commands;
 * it hands finished channel peers back through the peer acceptor.
 */
export class HostRemoteAccess {
  private readonly options: HostRemoteAccessOptions;
  private readonly identity: HostIdentity;
  private user: HostRelayUser;
  private settings: RemoteAccessSettings;
  private readonly hostName: string;
  private connector: RelayConnector | undefined;
  /** Between start() and stop(): configuration changes reconnect the relay right away. */
  private running = false;
  private relayStatus: RelayConnectorStatus = { state: 'off' };
  private peerAcceptor: ((peer: ChannelPeerSession) => void) | undefined;
  private directUrlProvider: () => string | undefined = () => undefined;
  private readonly direct: { handler: HostChannelUpgradeHandler; close: () => void };

  private constructor(
    options: HostRemoteAccessOptions,
    state: { identity: HostIdentity; user: HostRelayUser; settings: RemoteAccessSettings },
  ) {
    this.options = options;
    this.identity = state.identity;
    this.user = state.user;
    this.settings = state.settings;
    this.hostName =
      normalizeRemoteDisplayName(options.hostName ?? defaultHostName()) ?? 'piwin Host';
    this.direct = createDirectChannelUpgradeHandler({
      ids: () =>
        this.settings.direct.enabled
          ? { identity: this.identity, userId: this.user.userId }
          : undefined,
      admitHandshake: (key) => this.admitHandshake(key),
      onOpen: (peer) => this.acceptPeer(peer),
    });
  }

  /** Loads (or creates) identity, relay user and settings. Damaged files throw. */
  public static async open(options: HostRemoteAccessOptions): Promise<HostRemoteAccess> {
    const identity = await options.identityStore.loadOrCreate();
    const user =
      (await options.userStore.load()) ??
      (await options.userStore.create(options.defaultUserName ?? defaultUserName()));
    const settings = await options.settingsStore.load();
    return new HostRemoteAccess(options, { identity, user, settings });
  }

  public get directUpgradeHandler(): HostChannelUpgradeHandler {
    return this.direct.handler;
  }

  public setPeerAcceptor(acceptor: (peer: ChannelPeerSession) => void): void {
    this.peerAcceptor = acceptor;
  }

  /** Base `ws://host:port` shells may dial directly; set by whoever owns the listener. */
  public setDirectUrlProvider(provider: () => string | undefined): void {
    this.directUrlProvider = provider;
  }

  public start(): void {
    this.running = true;
    this.restartRelay();
  }

  /** Stops the relay connection; the Host can `start()` it again (listener restarts). */
  public stop(): void {
    this.running = false;
    this.connector?.stop();
    this.connector = undefined;
    this.relayStatus = { state: 'off' };
  }

  /** Stops the relay and closes the direct route for good. */
  public dispose(): void {
    this.stop();
    this.direct.close();
  }

  public legacyAccess(): LegacyAccessMode {
    return this.settings.legacyAccess;
  }

  /** ADR 0101 §5.3: answer a handshake only for a known device or while a code is live. */
  public admitHandshake(channelPublicKey: string): boolean {
    return (
      this.options.pairing.findByChannelKey(channelPublicKey) !== undefined ||
      this.options.pairing.hasPendingTokens()
    );
  }

  public status(): RemoteAccessStatusData {
    const directUrl = this.settings.direct.enabled ? this.directUrlProvider() : undefined;
    return {
      hostId: this.identity.hostId,
      hostName: this.hostName,
      user: { userId: this.user.userId, name: this.user.name },
      relay: {
        enabled: this.settings.relay.enabled,
        ...(this.settings.relay.url === undefined ? {} : { url: this.settings.relay.url }),
        state: this.settings.relay.enabled ? this.relayStatus.state : 'off',
        ...(this.relayStatus.lastCloseCode === undefined
          ? {}
          : { lastCloseCode: this.relayStatus.lastCloseCode }),
      },
      direct: {
        enabled: this.settings.direct.enabled,
        ...(directUrl === undefined ? {} : { url: directUrl }),
      },
      legacyAccess: this.settings.legacyAccess,
    };
  }

  /** v3 links for a freshly minted pairing token; undefined when no channel path is usable. */
  public readonly channelLinks: PairingChannelLinks = (token) => {
    const target = this.migrationTarget();
    if (target.relayUrl === undefined && target.directUrl === undefined) {
      return undefined;
    }
    const link = { v: 3 as const, ...target, ...token };
    return {
      channelUri: encodePairingLinkV3(link),
      ...(target.relayUrl === undefined
        ? {}
        : { webUri: encodePairingWebLink(target.relayUrl, link) }),
    };
  };

  /** Everything a shell needs to reach this Host on the channel (pairing links, migration). */
  public migrationTarget(): MigrationTarget {
    const relayUrl = this.settings.relay.enabled ? this.settings.relay.url : undefined;
    const directUrl = this.settings.direct.enabled ? this.directUrlProvider() : undefined;
    return {
      userId: this.user.userId,
      userName: this.user.name,
      hostId: this.identity.hostId,
      hostName: this.hostName,
      hostKey: this.identity.hostKey,
      ...(relayUrl === undefined ? {} : { relayUrl }),
      ...(directUrl === undefined ? {} : { directUrl }),
    };
  }

  public async configure(
    command: Extract<HostRemoteAccessCommand, { type: 'host/remote-access-configure' }>,
  ): Promise<RemoteAccessStatusData> {
    const relay = { ...this.settings.relay };
    if (command.relay?.url === null) delete relay.url;
    else if (command.relay?.url !== undefined) relay.url = normalizeRelayUrl(command.relay.url);
    if (command.relay?.enrollToken === null) delete relay.enrollToken;
    else if (command.relay?.enrollToken !== undefined)
      relay.enrollToken = command.relay.enrollToken;
    if (command.relay?.enabled !== undefined) relay.enabled = command.relay.enabled;
    if (relay.enabled && relay.url === undefined) {
      throw new Error('Set a relay address before turning the relay on');
    }
    await this.saveSettings({
      ...this.settings,
      relay,
      ...(command.legacyAccess === undefined ? {} : { legacyAccess: command.legacyAccess }),
    });
    this.restartRelay();
    return this.status();
  }

  public async createUser(name: string): Promise<RemoteAccessStatusData> {
    this.user = await this.options.userStore.create(name);
    this.restartRelay();
    return this.status();
  }

  public async renameUser(name: string): Promise<RemoteAccessStatusData> {
    this.user = await this.options.userStore.rename(name);
    this.restartRelay();
    return this.status();
  }

  public exportUser(passphrase: string): Promise<string> {
    return this.options.userStore.exportBundle(passphrase);
  }

  /** Moves this Host under another relay user (its owner's). */
  public async importUser(bundle: string, passphrase: string): Promise<RemoteAccessStatusData> {
    this.user = await this.options.userStore.importBundle(bundle, passphrase);
    this.restartRelay();
    return this.status();
  }

  public enrollmentLine(): Promise<string> {
    return this.options.userStore.enrollmentLine();
  }

  private acceptPeer(peer: ChannelPeerSession): void {
    if (this.peerAcceptor === undefined) {
      peer.close(4404, 'unavailable');
      return;
    }
    this.peerAcceptor(peer);
  }

  private restartRelay(): void {
    this.connector?.stop();
    this.connector = undefined;
    this.relayStatus = { state: 'off' };
    const { enabled, url, enrollToken } = this.settings.relay;
    if (!this.running || !enabled || url === undefined) {
      return;
    }
    const backoff = this.options.relayBackoffMs;
    this.connector = new RelayConnector({
      url,
      identity: this.identity,
      user: this.user,
      ...(enrollToken === undefined ? {} : { enrollToken }),
      admitHandshake: (key) => this.admitHandshake(key),
      onOpen: (peer) => this.acceptPeer(peer),
      onStatus: (status) => {
        this.relayStatus = status;
      },
      onReady: () => this.forgetEnrollToken(),
      ...(this.options.createRelaySocket === undefined
        ? {}
        : { createSocket: this.options.createRelaySocket }),
      ...(backoff === undefined ? {} : { minBackoffMs: backoff.min, maxBackoffMs: backoff.max }),
    });
    this.connector.start();
  }

  /** The relay has registered us; the one-time token has done its job. */
  private forgetEnrollToken(): void {
    if (this.settings.relay.enrollToken === undefined) {
      return;
    }
    const relay = { ...this.settings.relay };
    delete relay.enrollToken;
    void this.saveSettings({ ...this.settings, relay }).catch((error: unknown) =>
      this.options.onError?.(error instanceof Error ? error : new Error(String(error))),
    );
  }

  private async saveSettings(settings: RemoteAccessSettings): Promise<void> {
    await this.options.settingsStore.save(settings);
    this.settings = await this.options.settingsStore.load();
  }
}

function defaultHostName(): string {
  return hostname().replace(/\.local$/i, '');
}

function defaultUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return 'piwin';
  }
}

/**
 * Opens remote access with the standard files under `<piwinRoot>/devices/`:
 * host-identity.json, relay-user.json and remote-access.json (migrating the
 * ADR 0076 mobile-access.json on first load).
 */
export function openHostRemoteAccessAtRoot(
  options: Omit<HostRemoteAccessOptions, 'identityStore' | 'userStore' | 'settingsStore'> & {
    piwinRoot: string;
  },
): Promise<HostRemoteAccess> {
  const devices = join(options.piwinRoot, 'devices');
  const { piwinRoot: _piwinRoot, ...rest } = options;
  return HostRemoteAccess.open({
    ...rest,
    identityStore: new HostIdentityStore(join(devices, 'host-identity.json')),
    userStore: new RelayUserStore(join(devices, 'relay-user.json')),
    settingsStore: new RemoteAccessSettingsStore(join(devices, 'remote-access.json'), {
      legacyMobileAccessPath: join(devices, 'mobile-access.json'),
    }),
  });
}

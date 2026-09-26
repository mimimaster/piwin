/**
 * ADR 0027: Personal remote gateway — contracts seams (types only).
 *
 * This module is the leaf contract surface for the future W4 remote gateway.
 * It holds *types only*: device pairing, sink identity, the remote command
 * policy (W4 §3 capability subset), and the {@link PushSink} interface the
 * host runtime exposes to multiple consumers. No implementation lives here;
 * the gateway process, transport, E2EE, and pairing UI remain W4 future work.
 *
 * Design references (Cindy / `makecindy/cindy`) are recorded in ADR 0027. They
 * are *not* adopted here — only the shapes the future implementer will need.
 */

import type { HostPush } from './ipc.js';

/**
 * Product config section for the personal remote gateway (ADR 0027).
 *
 * Stored under `~/.piwin/config.json` as `remote`. Defaults to off — the
 * desktop opens no ports and dials no gateway unless `enabled` is true. This
 * shape matches W4 spec §6.
 */
export type RemoteConfig = {
  /** Master switch. Default false; desktop stays fully offline when off. */
  enabled: boolean;
  /** User-operated gateway URL the desktop dials out to (e.g. `wss://gw.example`). */
  gatewayUrl?: string;
  /** Secret ref (resolved by host secret-resolver) for the dial-out bearer token. */
  tokenRef?: string;
  /** Allow interactive PTY over remote. Default false (ipc R10). */
  allowPtyRemote?: boolean;
  /** Allow the CE-TUN tunnel surface over remote. Default false. */
  allowTunnel?: boolean;
  /** Opt into E2EE on the remote path. Default false; only needed on public internet. */
  e2ee?: boolean;
  /** Per-remote-command policy override; defaults via {@link createDefaultRemoteCommandPolicy}. */
  policy?: Partial<RemoteCommandPolicy>;
};

/**
 * Stable identifier for a push sink attached to the host runtime.
 *
 * The legacy single-`onPush` sidecar is registered under
 * {@link LEGACY_LOCAL_SINK_ID}. A future gateway connector attaches under its
 * own id so the host can fan out without knowing what a "gateway" is.
 */
export type RemoteSinkId = string;

/** Sink id reserved for the local sidecar (stdin/stdout JSONL). */
export const LEGACY_LOCAL_SINK_ID = 'local-sidecar' as const;

/**
 * A consumer of {@link HostPush} frames.
 *
 * The host runtime calls `push` for every frame. `sequenced` opts the sink into
 * transport-level `seq`/`eventId` tagging and reconnect replay via
 * `host/replay`; a non-sequenced sink (the legacy local sidecar by default)
 * receives frames as before, without seq fields.
 */
export interface PushSink {
  readonly id: RemoteSinkId;
  /** True when the sink wants `seq`/`eventId` on each push and replay support. */
  readonly sequenced?: boolean;
  push(message: HostPush): void;
}

/**
 * A one-use pairing token minted by the host for a new remote device.
 *
 * Reference: Cindy's `PairingTokenManager` — random token, short TTL, only
 * usable for the pair/auth handshake on an unauthenticated channel. The host
 * stores the *hash* of the secret the device later presents, never the secret
 * itself.
 */
export type PairingToken = {
  /** Opaque token string the desktop displays (e.g. inside a QR). */
  token: string;
  /** Epoch ms when the token expires. Suggested default: 10 min. */
  expiresAt: number;
  /** Host-side challenge the device must answer to register. */
  challenge?: string;
};

/**
 * Public view of a trusted remote device, after pairing completes.
 *
 * Reference: Cindy's `TrustedDeviceStore` — dedup by `secretHash`, support
 * revoke/remove, update `lastSeenAt` on each auth. The secret itself never
 * leaves the device; only its hash is persisted.
 */
export type TrustedDevicePublic = {
  id: string;
  name: string;
  /** Hash of the device secret; never the raw secret. */
  secretHash: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  /**
   * The installation's hello `clientId`. A later pairing from the same
   * installation replaces this record instead of listing the device twice.
   */
  clientId?: string;
};

/**
 * Credential returned exactly once when a pairing token is consumed. The raw
 * secret is presented on later hellos. The Host must never persist it or
 * include it in a public device listing.
 */
export type TrustedDeviceCredential = {
  deviceId: string;
  deviceSecret: string;
};

/** Result of a successful one-use pairing enrollment. */
export type PairingCompletion = {
  credential: TrustedDeviceCredential;
  device: TrustedDevicePublic;
};

export function isTrustedDeviceCredential(value: unknown): value is TrustedDeviceCredential {
  return (
    typeof value === 'object' &&
    value !== null &&
    'deviceId' in value &&
    'deviceSecret' in value &&
    typeof value.deviceId === 'string' &&
    value.deviceId.trim().length > 0 &&
    typeof value.deviceSecret === 'string' &&
    value.deviceSecret.trim().length > 0
  );
}

/**
 * The W4 §3 "WebUI capability subset" — what a remote client may do.
 *
 * Default-deny surfaces stay false; the host enforces this policy at the
 * command boundary so the gateway relay cannot bypass it. This is the
 * contract-level shape; the host-side enforcement is W4 implementation.
 */
export type RemoteCommandPolicy = {
  /** Session list/create/prompt/abort, plan view. Default true. */
  allowSessionControl: boolean;
  /** Resolve permission requests from remote. Default true. */
  allowPermissionResolve: boolean;
  /** Read-only memory/notes search. Default true. */
  allowMemoryRead: boolean;
  /** Delete memory/notes from remote. Default false. */
  allowMemoryDelete: boolean;
  /** Process list/logs/stop. Default true. */
  allowProcessObserve: boolean;
  /** Start a new managed process from remote. Default false. */
  allowProcessStart: boolean;
  /** Interactive PTY over remote. Default false (ipc R10: needs its own design). */
  allowPtyRemote: boolean;
  /** Install/uninstall extensions or plugins from remote. Default false. */
  allowExtensionInstall: boolean;
  /** Edit raw secrets from remote. Default false. */
  allowSecretEdit: boolean;
};

export function createDefaultRemoteCommandPolicy(): RemoteCommandPolicy {
  return {
    allowSessionControl: true,
    allowPermissionResolve: true,
    allowMemoryRead: true,
    allowMemoryDelete: false,
    allowProcessObserve: true,
    allowProcessStart: false,
    allowPtyRemote: false,
    allowExtensionInstall: false,
    allowSecretEdit: false,
  };
}

/**
 * Capability handshake fields a remote client reads from `host/status` to gate
 * features (ipc-transport-discipline R6: gate on capability, not "same repo").
 */
export type RemoteCapabilityFlags = {
  /** Host accepts remote gateway sinks (ADR 0027 seams present). */
  remoteGateway: boolean;
  /** Host tags pushes with seq/eventId and supports host/replay. */
  pushSequencing: boolean;
};

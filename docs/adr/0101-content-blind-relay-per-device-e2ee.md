# ADR 0101: Relay-first remote access — one end-to-end channel for every remote shell

| Field | Value |
|-------|-------|
| Status | **Accepted — partially implemented** (owner decisions 2026-10-25; P0–P3 shipped: protocol, relay, Host side) |
| Date | 2026-10-25 |
| Scope | `@piwin/contracts`, `@piwin/host-transport`, `@piwin/host-server`, `@piwin/host-client`, new `apps/gateway`, `apps/desktop`, `apps/mobile`, `apps/cli` (incl. `tui`), `apps/host` |
| Amends | [0027](./0027-personal-remote-gateway-seams.md) (gateway topology, `RemoteConfig`), [0075](./0075-operator-host-pairing.md) (operator identity, token door), [0076](./0076-bundled-phone-access-lan.md) (cleartext LAN listener), [0086](./0086-cli-tui-on-remote-protocol.md) (TUI attach target) |
| Related | [0036](./0036-host-server-multi-client-deployment.md), [0037](./0037-mobile-remote-shell.md), [0084](./0084-mobile-shell-default-web-interface.md) |
| Plan | [`plans/2026-10-25-relay-e2ee-implementation.md`](../plans/2026-10-25-relay-e2ee-implementation.md) |

## Owner decisions (2026-10-25)

1. **Self-hosted relay only; it becomes the main way in.** No official relay,
   no default relay URL. Once a user has a relay, every remote shell goes
   through it, and direct dialing is the fallback.
2. **One channel everywhere.** The direct LAN/tailnet path speaks the same
   end-to-end channel as the relay. No cleartext way in remains.
3. **Every remote shell uses it**: phone, Desktop thin shell, CLI one-shot
   commands, `piwin tui`, browser shell. One pairing model replaces the token
   door, env-var secrets and cleartext LAN hello.
4. **No forced re-pair.** Already paired clients migrate automatically
   during a transition window (§10).
5. **A relay user ID stands in for accounts.** piwin has no account system.
   A key-derived `userId` with a display name is the tenant on a relay: it
   gates who may use the relay and keeps users on a shared relay invisible to
   each other. A client still connects to exactly one Host (§3).

## Context

Remote access has grown four shapes, each with its own credential story, and
all of them need the client to reach the Host's address directly:

| Shell | Today |
|-------|-------|
| Phone | QR → cleartext `ws://` to LAN/tailnet → device credential (ADR 0076) |
| Desktop thin shell | Endpoint + shared `authToken` in settings (operator door, ADR 0075) |
| CLI / TUI | `PIWIN_HOST_URL` + `PIWIN_HOST_TOKEN` or `PIWIN_HOST_DEVICE_ID/SECRET` (ADR 0086) |
| Browser | Workbench served by the Host HTTP listener, then the same WebSocket |

Off the home network that means a VPN, tunnel or TLS reverse proxy.
ZCode and WorkBuddy (2026-08) set the bar users now expect: scan once, works
from any network, because both sides dial out to a relay. Their trust models
do not fit a private tool. ZCode's link is the credential. WorkBuddy's account
server sees content.

oh-my-pi `/collab` (`docs/collab.md`, `packages/collab-web/scripts/local-relay.ts`)
is the closest reference: a content-blind relay with a 4-byte peer prefix plus
a sealed payload, guest-prefix rewriting, and `peer-joined` / `peer-left` /
`room-closed` control frames. piwin keeps that shape and fixes three gaps: a
single shared room key (so a guest cannot be revoked on its own), no forward
secrecy, and room ids claimed first-come, first-served.

Everything behind the transport already exists: one `HostCommand` /
`HostPush` path, per-device pairing and revocation, `seq` + `host/replay`
reconnect, and a workbench that runs on every shell.

## Decision

### 1. Path model

```text
                     ┌──── relay (self-hosted apps/gateway) ────┐
any remote shell ────┤                                           ├──── Host
                     └──── direct: Host's own /v1/u/…/connect ──┘
        └──────────── Noise IK end to end, same bytes on both paths ───┘

local Desktop sidecar / loopback CLI ── unchanged (stdio JSONL or 127.0.0.1) ── Host
```

- **Relay (primary).** The Host dials out to the user's relay. Clients dial
  the relay and name the Host by `userId` + `hostId`. The Host opens no
  inbound port.
- **Direct (fallback).** The Host's network listener serves the same
  `connect` route for exactly one Host, with the same envelope and channel.
- **Selection.** Relay first. Direct only when the relay is unreachable or
  answers `4404`. No LAN-probing race.
- **Loopback is not remote.** The stdio sidecar and same-machine `127.0.0.1`
  connections keep `directLoopback` admission.
- The relay never imports Pi, never parses `HostCommand`, never holds a
  traffic key, and persists only its user registry (§3). AGENTS.md §1.13
  holds.

### 2. Keys and identifiers

| Key | Owner | Stored | Purpose |
|-----|-------|--------|---------|
| User key (Ed25519) | the person | `~/.piwin/devices/relay-user.json` 0600 on each Host they own | Proves the Host belongs to `userId` |
| Host signing key (Ed25519) | Host | `~/.piwin/devices/host-identity.json` 0600 | Proves `hostId` |
| Host static key (X25519) | Host | same file | Noise responder key, pinned by clients |
| Client static key (X25519) | each client installation, per Host | phone/Desktop: Keychain; CLI: `~/.piwin/client/hosts/<hostId>.json` 0600; browser: IndexedDB | Noise initiator key, bound to the device record |

Identifier derivation (domain-separated so keys cannot be confused):

```text
userId = base64url( SHA-256("piwin-user-v1\0" ‖ userPub) )[0..16 bytes]   // 22 chars
hostId = base64url( SHA-256("piwin-host-v1\0" ‖ hostSignPub) )[0..16 bytes]
```

- Display names (`userName`, `hostName`) are labels only, at most 64 UTF-8
  characters after NFC, and are never used for routing or authorization. Two
  users may share a name. They never share an ID.
- Each client keeps a **host book**:
  `{ userId, userName, hostId, hostName, hostKey, relayUrl?, directUrl?, credential, role }`.
  The UI groups entries by user. Each entry is one connection to one Host.
- Rotating a Host identity forces re-pair for that Host. Rotating the user
  key requires re-registering on the relay (§8) and re-signing each Host. No
  client re-pairs, because clients pin `hostKey`, not the user key; the new
  `userId` (part of every connect URL) reaches them through the
  `host/endpoints` push (P4).

### 3. Relay users (account stand-in)

A relay user is the tenant boundary on a relay.

- **Registry.** The relay keeps `users.json`:

  ```json
  {
    "version": 1,
    "users": [
      {
        "userId": "…22…",
        "publicKey": "<base64url Ed25519>",
        "name": "Yorick",
        "disabled": false,
        "limits": { "maxHosts": 8, "maxPeersPerHost": 32 }
      }
    ],
    "deniedHosts": []
  }
  ```

  The relay re-derives `userId` from `publicKey` on load and refuses an entry
  whose IDs do not match. The file is read at start and on `SIGHUP`, and is
  written atomically by the admin CLI.
- **Enrollment.** There are two ways in. Both end in a registry row.
  1. **Paste.** The Host shows an enrollment line,
     `piwin-user:v1:<publicKey>:<name>`. The relay admin runs
     `piwin-gateway user add '<line>'`.
  2. **Enrollment token.** The relay starts with
     `PIWIN_RELAY_ENROLL_TOKEN=<secret>`. A Host that presents the token
     during its first auth (§7) registers its user automatically. This is the
     one-step setup for a single-person self-hosted relay. The token is
     compared in constant time, is never logged, and can be removed after
     setup.
- **Multiple Hosts, one user.** On the first Host, `piwin relay user export`
  writes a passphrase-sealed bundle (scrypt N=2^17, r=8, p=1, then
  XChaCha20-Poly1305). `piwin relay user import` on another Host loads it.
  This is the person copying their own key between their own machines. There
  is no server.
- **Isolation.** All routes are scoped by `userId`. A wrong `userId`, an
  unknown `hostId` and an offline Host all return the same `4404`, so a user
  cannot probe another user's Hosts or their online state. Limits apply per
  user.
- **Admin.** `piwin-gateway user add | list | disable <userId> | remove <userId>`
  and `piwin-gateway host deny <hostId>`. Disabling a user or denying a host
  closes its live sockets.
- **Future accounts.** If piwin ever adds accounts, an account maps to one or
  more `userId`s. The wire protocol does not change.

### 4. End-to-end channel: `Noise_IK_25519_ChaChaPoly_SHA256`

- The client is the initiator and knows `hostKey` from pairing or migration.
- Prologue: `"piwin-channel-v1\0" ‖ userId ‖ hostId`. A handshake replayed
  under another user or Host fails.
- Message 1 carries no application payload. Data starts after message 2.
- Every connection runs a fresh handshake, so every connection has forward
  secrecy. Both cipher states call `Rekey()` every 2^20 messages.
- In-channel frames are `[kind:u8][flags:u8][payload]`, where `kind` is
  `0x01` for wire JSON or `0x02` for binary, and `flags & 0x01` means more
  fragments follow. A reassembled message is capped at
  `HOST_WIRE_HARD_FRAME_BYTES`.
- One ordered WebSocket per channel. Any decrypt or nonce failure closes it.

**Library.** `@noble/curves` (x25519, ed25519), `@noble/ciphers`
(chacha20poly1305, xchacha20poly1305) and `@noble/hashes` (sha256, hmac,
hkdf, scrypt). They are audited, pure TypeScript and dependency-free, and run
in Node, browsers and WKWebView. The IK state machine (about 300 lines) lives
in `@piwin/host-transport` and must match the published Noise test vectors.

Rejected: WebCrypto (uneven X25519 in the WKWebView versions we ship, no
ChaCha), `node:crypto` (not in browsers), libsodium WASM (too heavy), and
libp2p-noise (XX-only, tied to libp2p).

### 5. Admission and roles

After the handshake, the client sends the usual `client/hello` inside the
channel.

1. **Pairing.** `hello.pairingToken` goes through
   `HostDevicePairing.completePairing`. The Host records the handshake's remote
   static key as the device's `channelPublicKey` (taken from the handshake,
   never from a field), along with the `role` the token was minted for.
2. **Reconnect.** `hello.deviceCredential` must authenticate, **and**
   `channelPublicKey` must equal the handshake key. Otherwise the Host
   rejects with `device-credential-invalid`.
3. **Early drop.** If the message-1 static key matches no active device and
   no pairing token is pending, the Host aborts before replying.
4. **Revocation.** Revoking a device also closes its channels.
5. **Roles.** Device records gain `role: 'member' | 'operator'`.
   - `member` is the default and gets the per-device capability ceiling (W4
     §3).
   - `operator` adds pairing, remote-access and relay-user management, plus
     the commands ADR 0075 reserved for operators.
   - Only an operator (loopback, or an operator device) can mint an operator
     pairing token, and only on explicit request.
6. **Removed after the window.** The shared `authToken` door and the
   cleartext device hello on network listeners go away. Loopback needs
   neither.

### 6. Pairing link v3

One payload, two spellings:

```text
piwin://pair?v=3&userId=…&userName=…&hostId=…&hostName=…&hostKey=…
            &relay=wss://relay.example.com
            &direct=ws://192.168.1.20:8790
            &pairingToken=…&role=member&expiresAt=…

https://relay.example.com/#pair=<base64url(JSON of the same fields)>
```

- `piwin://` is used for the QR in native shells and for
  `piwin pair '<link>'`. `https://` opens the browser shell the relay serves.
  The fragment never reaches a server, and the shell strips it from the
  address bar after reading it.
- At least one of `relay` / `direct` must be present. `hostKey` is pinned.
  The pairing token is single-use and lasts 10 minutes.
- When the relay or direct address changes, the Host pushes `host/endpoints`
  over the authenticated channel and the client updates its host book. There
  is no re-pair.

### 7. Wire protocol v1

| Route | Served by | Behavior |
|-------|-----------|----------|
| `GET /v1/u/<userId>/host?hostId=` (WS) | relay | The relay sends `{"t":"challenge","nonce"}` (32 random bytes). The Host replies `{"t":"auth","hostPub","userPub","hostSig","userSig","enrollToken"?}`. Both signatures cover `piwin-relay-v1\0host\0` ‖ nonce ‖ userId ‖ hostId. The relay checks the derivations, that the user is registered and enabled (or enrolls it with a valid token), that the host is not denied, `maxHosts`, and both signatures. It then sends `{"t":"ready"}`. A newly authenticated socket for the same `hostId` replaces the old one (`4409` to the old). Auth must finish within 10 s. |
| `GET /v1/u/<userId>/connect?hostId=` (WS) | relay **and** Host direct listener | Assigns a `u32` peer id and sends `peer-joined` to the Host. If the user is unknown or disabled, the host is unknown or not attached, or the IDs do not match, it closes with `4404`. |
| `GET /healthz` | both | Liveness. |
| `GET /` (static) | relay, optional `--web-root` | Browser shell. |

- **Binary frames** are `[peer:u32 BE][Noise message]`. The relay overwrites
  the prefix on client frames and routes Host frames to one peer. There is no
  broadcast. Clients always send a prefix, and the direct listener ignores
  it.
- **Text control** comes from the relay (`peer-joined`, `peer-left`,
  `host-replaced`), with one Host→relay exception after ready:
  `{"t":"peer-close","peer","code","reason"?}` closes one of that Host's
  clients (revocation, failed handshake); `code` must be 4000–4999. Any other
  Host text after ready closes the Host with `4400`.
- **Close codes**:

  | Code | Meaning |
  |------|---------|
  | `4400` | malformed request |
  | `4401` | Host auth failed |
  | `4403` | user disabled or host denied (Host route only) |
  | `4404` | not available (deliberately ambiguous) |
  | `4409` | replaced |
  | `4413` | frame too large |
  | `4429` | limit or rate exceeded |

- **Limits**:
  - frame ≤ 70 KiB;
  - per-user `maxHosts` (default 8) and `maxPeersPerHost` (default 32);
  - per-IP connection rate limit;
  - ping every 25 s;
  - a peer whose send buffer exceeds 4 MiB is closed. It recovers through
    `lastSeq` replay. The relay keeps no buffer.
- **Logging.** The relay logs `userId` / `hostId` prefixes (6 characters),
  counts and close codes only. IP logging is off unless enabled.

### 8. Shells

One client stack: `HostClient` → `WebSocketHostTransport` →
`RelaySecureSocket` (a `WebSocketLike` over a platform socket). Heartbeat,
backoff, `wake()` and replay are reused unchanged.

| Shell | Pair | Key store | Notes |
|-------|------|-----------|-------|
| Phone | Scan QR | Keychain | Host book grouped by user. Shows the current path. `4404` shows "电脑离线". The native socket gains binary send. |
| Desktop thin shell | Paste link or scan | Keychain (Tauri) | Replaces the endpoint + token form. Usually `operator`. |
| Bundled Desktop | — | — | Its own sidecar over loopback, as today. Settings → "远程访问" manages the relay user, relay URL, direct listener, pairing and devices. |
| CLI / `piwin tui` | `piwin pair '<link>'` | `~/.piwin/client/hosts/` 0600 | `piwin hosts list \| use \| forget`. `PIWIN_HOST=<alias>` selects a Host. `PIWIN_HOST_URL` is loopback-only. |
| Browser | Open `https://relay/#pair=…` | IndexedDB | Served by the relay (`--web-root`) or by the Host listener. |

The browser shell trusts whoever serves its JavaScript. With self-hosted
relays that is the user. This is documented. Native shells do not depend on
it.

### 9. Operator surface and config

- `~/.piwin/devices/remote-access.json` holds:

  ```json
  {
    "version": 1,
    "relay": { "enabled": false, "url": null },
    "direct": { "enabled": true, "port": 8790, "advertisedUrl": null },
    "legacyAccess": "full"
  }
  ```

  It replaces `mobile-access.json`, migrating `enabled` and `port`. The
  relay URL must be `wss://`, except `ws://` on localhost.
  `legacyAccess` is `full | migrate-only | off`; its default follows the
  release schedule in §10.
- `host/pairing-status` carries a `remote` block (`RemoteAccessStatusData`):
  host id and name, user, relay state (`off | connecting | ready | error` plus
  last close code), direct state and `legacyAccess`.
- `host/remote-access-configure` is operator-only. `host/pairing-create-code`
  takes `role`; pairing codes add `channelUri` (`piwin://pair?v=3…`) and, with
  a relay, `webUri` (`https://relay/#pair=…`).
- `host/relay-user-*` operator commands:
  - `create { name }`
  - `rename`
  - `export { passphrase }` → bundle
  - `import { bundle, passphrase }`
  - `enrollment-line`
- **Standalone Host bootstrap.** `apps/host` (and `piwin host serve`)
  creates its identity and a relay user on first start, using
  `PIWIN_HOST_USER_NAME` or the OS username; `PIWIN_HOST_RELAY_URL`,
  `PIWIN_RELAY_ENROLL_TOKEN` and `PIWIN_HOST_LEGACY_ACCESS` apply settings.
  While no operator device exists, it prints an operator v3 pairing link.
  `piwin host pair [--operator]` (P5) mints more codes over loopback.
- The bundled Desktop's phone-access listener carries the direct channel
  route and runs the relay connector while the listener runs; a damaged
  identity disables remote access but not LAN phone access.
- `apps/gateway` ships as a Node bin and a Docker image:
  - `--port`, `--host`, `--trust-proxy`, `--users <path>`, `--web-root`;
  - TLS through a reverse proxy (the guide has a Caddy example).
- `RemoteConfig.gatewayUrl` / `tokenRef` / `e2ee` (ADR 0027) are removed.

### 10. Migration: no forced re-pair

Already paired clients keep their device credential or token, and their Host
address. Migration adds what the new channel needs (the pinned `hostKey`,
the user and host IDs, and a client static key bound to a device record) over
one last legacy connection.

**Release schedule** (N = the release that ships this ADR):

| Release | Host `legacyAccess` default | Effect |
|---------|-----------------------------|--------|
| N | `full` | Old clients keep working unchanged. Upgraded clients migrate on first connect. |
| N+1 | `migrate-only` | The legacy path accepts only `host/status` and `host/channel-migrate`. Everything else returns reject reason `secure-channel-required`. |
| N+2 | `off` (setting removed) | The legacy path is deleted. Unmigrated records show "需重新配对". |

An operator may move to `migrate-only` or `off` earlier through
`host/remote-access-configure`.

**`host/channel-migrate`** (legacy path only; the caller has already passed
legacy hello):

```ts
request:  { channelPublicKey: string; clientId: string; deviceName?: string }
response: {
  userId; userName; hostId; hostName; hostKey;
  relayUrl?: string; directUrl?: string;
  credential?: TrustedDeviceCredential;   // only when a new record was created
  role: 'member' | 'operator';
}
```

- **Device-credential caller (phone, CLI with `PIWIN_HOST_DEVICE_*`).** The
  Host binds `channelPublicKey` to the existing record. The role stays
  `member`, and the credential is unchanged.
- **Token caller (thin shell, CLI with `PIWIN_HOST_TOKEN`).** The Host
  creates a new `operator` record and returns its credential. A
  `clientId` that was already migrated replaces its earlier record (the same
  dedup rule as ADR 0075).
- The call is idempotent per `(record, channelPublicKey)`. A second call with
  a different key on an already-bound record is rejected, so a stolen legacy
  credential cannot re-bind a live device. Re-binding needs revoke plus
  re-pair.
- Each migration is logged on the Host, and the device list shows "已迁移 ·
  <time>".

**Client migrator** (`@piwin/host-client` `legacy-host-migrator.ts`):

1. On start, find legacy entries:
   - the mobile vault's saved endpoint and credential;
   - the Desktop remote-target endpoint and token;
   - CLI `PIWIN_HOST_URL` (non-loopback) with a token or device env.
2. Generate a client static key, connect on the legacy path, and call
   `host/channel-migrate`.
3. Write the host book entry, verify a new-channel hello succeeds, and only
   then delete the legacy record.
4. If the Host does not know the command (it is older), keep the legacy
   entry and retry on the next start.
5. The CLI prints once that the env vars can be removed and names the new
   alias.

**Security.**

- Over a cleartext LAN legacy connection, a man in the middle at the moment of
  migration could substitute `hostKey`. That is no worse than today, because
  today the credential crosses that same link on every connect. After
  migration the exposure is gone for good.
- Legacy connections over tailnet or `wss://` are already protected.
- An operator who wants zero trust-on-first-use can set
  `legacyAccess: 'off'` and re-pair by QR instead.

### 11. Components

| Piece | Package | Notes |
|-------|---------|-------|
| Envelope, control frames, close codes, link v3, user/host IDs, migration types | `@piwin/contracts` (types) + `@piwin/host-transport` (codecs, ID derivation) | Shared by Host, clients and relay |
| Noise IK, fragmentation, `RelaySecureSocket` | `@piwin/host-transport` | Portable: no Node or DOM APIs |
| Host book, link parse, key vault, dial strategy, legacy migrator | `@piwin/host-client` | Storage injected per shell |
| User store and bundle, Host identity, remote-access settings, `RelayConnector`, direct `connect` route, channel admission, migration command | `@piwin/host-server` | Peers enter HostServer as `HostPeerSocket`. The WS server moves to `noServer` + path routing so the legacy and new routes share one port during the window. |
| Relay server, user registry, admin CLI | `apps/gateway` | Depends on `ws`, `@piwin/host-transport`, `@piwin/contracts` only |

## What the relay operator can and cannot do

| Can | Cannot |
|-----|--------|
| See `userId`, `hostId`, peer counts, client IPs, frame sizes and timing | Read or alter any command, push, prompt, file or credential |
| Admit, limit, disable users; deny hosts | Impersonate a Host (pinned `hostKey`) or a client (bound key + secret) |
| Drop or delay traffic | Enroll a client without a live pairing token, or replay frames |
| Serve modified browser-shell JavaScript (browser-only risk) | Affect native shells this way |

Users sharing a relay are isolated from each other: one user cannot attach a
Host under another's `userId` (that needs the user key), cannot connect to
another's Host (that needs pairing), and cannot learn whether another's Host
is online (`4404` is ambiguous).

## Consequences

Positive:

- Every remote shell works from any network after one scan or paste, and
  existing clients do not even need that.
- One credential model and one channel replace the token door, env-var
  secrets and cleartext LAN hello. This closes ADR 0076's cleartext gap.
- A relay can be shared by family or a team with per-user admission and
  limits, without an account service.
- Per-client revocation, per-connection forward secrecy. HostRuntime, replay,
  idempotency and the workbench are untouched.

Negative:

- The legacy path lives for two more releases (in `migrate-only` for the
  second).
- About 300 lines of security-critical Noise code, plus scrypt-sealed user
  bundles to own. Mitigated by test vectors and golden cases.
- Three new runtime dependencies (`@noble/*`).
- The relay is no longer fully stateless: it persists `users.json`. It still
  stores no traffic.
- `host-server.ts` (911 lines) must be split, and `HostClientConnection` must
  drop the concrete `ws` type, before the feature work.

## Rejected alternatives

- **An official public relay.** Rejected by the owner.
- **Direct-first with an optional relay.** Rejected by the owner.
- **Forced one-time re-pair.** Rejected by the owner. Migration is cheap and
  no less secure than the status quo.
- **Names as tenant keys.** Names collide and can be forged. IDs are derived
  from keys.
- **An account service.** Out of scope for a self-hosted product. `userId` is
  the forward-compatible seam.
- **oh-my-pi style "link is the key".** No per-device revocation, no forward
  secrecy.
- **TLS SNI passthrough.** Needs Host certificates and cannot route by
  device.
- **A relay-side replay buffer.** Duplicates Host `seq` replay.

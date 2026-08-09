# ADR 0027: Personal remote gateway — protocol & runtime seams (defer implementation)

| Field | Value |
|-------|-------|
| Status | **Accepted — protocol seams retained; topology superseded by ADR 0036** |
| Date | 2026-08-03 |
| Related | [`specs/w4-remote-gateway.md`](../specs/w4-remote-gateway.md), [`specs/host-server-multi-client.md`](../specs/host-server-multi-client.md), ADR 0036, ADR 0006 (sidecar transport), ADR 0015 (async turn transport), [`ipc-transport-discipline.md`](../ipc-transport-discipline.md) |

## Context

[`specs/w4-remote-gateway.md`](../specs/w4-remote-gateway.md) originally
sketched a personal remote gateway: a browser WebUI (and, by extension, a
mobile client) controls the **same local agent** through a relay, reusing
`HostCommand` / `HostPush` over WebSocket. ADR 0036 expands that target: the
Host itself is now a deployable service, while a Gateway is only an optional
relay/tunnel for reaching it.

A separate, already-shipped open-source project (Cindy / `makecindy/cindy`)
demonstrates the same product shape today: a desktop agent plus a mobile client
that can view, question, and take over desktop sessions. Its architecture is
instructive as a reference because it validates three assumptions piwin has
already baked into its wire protocol:

1. **One JSON-RPC path.** Mobile events inject into the *same* run/permission
   path the desktop renderer uses — there is no second agent loop. piwin's
   `HostCommand` / `HostPush` is exactly that single path, and
   [`ipc-transport-discipline.md`](../ipc-transport-discipline.md) R1–R10 was
   written with "tomorrow the same protocol may run over WebSocket/SSH to a
   remote host" in mind.
2. **The host is the broker; remote clients are just clients.** Cindy's
   Electron main process routes mobile events through the same bridge as the
   renderer. piwin's `HostRuntime` is the equivalent authority, but today it
   exposes a single `onPush` callback to a single sidecar transport.
3. **Sequenced push + replay buffer for reconnect.** Cindy's relay keeps a
   per-session ring buffer and replays from `lastSeq` on reconnect. piwin
   already has the seed: `AgentEventEnvelope` carries `eventId` + `sequence` +
   `runId` for idempotent delivery — but only on the `event`-kind `HostPush`.

The cost of *not* leaving seams now is that the first real gateway
implementation would have to retrofit sequencing onto every `HostPush` variant,
rebuild the transport boundary around a single stdio reader, and wedge a second
sink into `HostRuntime` — all disruptive, protocol-breaking changes that touch
every consumer of `@piwin/contracts`. Leaving the seams now keeps the future
work purely additive, per ipc-transport-discipline R6 (versionable, additive
evolution).

This ADR records the **seams only**. It does not implement a gateway, a WebUI,
E2EE, a relay, device-pairing UI, or a sync server. Those remain W4.

## Decision

### 1. Topology: Host Server first, Gateway optional

The canonical topology is **client shell → Host Server → HostRuntime → Pi**.
The Host Server may run as a local sidecar or independently on a Mac,
Windows/Linux machine, NAS, or server. Clients may reach it over a private LAN,
Tailscale/Headscale, WireGuard, SSH forwarding, or another protected tunnel.

The earlier **desktop → outbound dial → Gateway → mobile/browser** topology is
retained as an optional NAT-friendly relay mode. It is not required for private
LAN/VPN deployments and the Gateway never becomes the execution authority.

### 2. Protocol: reuse `HostCommand` / `HostPush`, add sequencing to all pushes

The wire protocol stays `HostCommand` / `HostPush` JSON (R1). The gateway is a
dumb relay that frames and authenticates; it does not interpret commands beyond
routing. To support reconnect/replay:

- Every `HostPush` gains **optional** `seq?: number` and `eventId?: string`
  fields. The host assigns a monotonically increasing `seq` per host process
  (not per session) when a sequenced sink is attached. Existing consumers ignore
  the fields; the seam is backward-compatible (R6 additive).
- A new control command `host/replay { sinceSeq }` asks the host to re-emit
  buffered pushes from `sinceSeq` (exclusive) to the calling sink. The host
  keeps a bounded ring buffer when any sink has opted into sequencing.
- `HostStatusData.capabilities` gains `remoteGateway?: boolean` and
  `pushSequencing?: boolean` so a remote client can gate on capability rather
  than "same repo" (R6).

`AgentEventEnvelope` (already on `event` pushes) is **not** removed; `seq` on
the outer `HostPush` is the transport-level sequence, while the envelope's
`sequence` remains the per-session event sequence. They answer different
questions ("did I miss a push on this socket?" vs "did I miss an event in this
session?").

### 3. Runtime: multi-sink `HostRuntime`, transport-agnostic serve loop

- `HostRuntime` exposes `attachPushSink(id, sink)` / `detachPushSink(id)` in
  addition to the legacy `onPush` option. The legacy `onPush` becomes a default
  sink registered under a stable id. This lets a future gateway connector
  attach as a second sink without the host knowing about gateways.
- `apps/cli/src/host-serve-dispatcher.ts` is already transport-agnostic
  (`dispatch(command)` + `writer`). The stdio coupling lives in
  `commandHostServe`'s readline loop. That loop is extracted into a
  `JsonlStdioTransport` with a small interface (`Transport`: `start(dispatch)`,
  `stop()`, `send(message)`). A future `WebSocketTransport` / `GatewayDialTransport`
  implements the same interface, so the dispatcher and `HostRuntime` are reused
  unchanged.

### 4. Contracts: `remote` config + device/policy types (no runtime behavior)

- `PiwinConfig` gains `remote?: RemoteConfig` (`gatewayUrl?`, `tokenRef?`,
  `enabled`, `allowPtyRemote?`, `allowTunnel?`, `e2ee?`). Default off. Matches
  the W4 spec §6 shape.
- A new `packages/contracts/src/remote.ts` holds the **types only** for the
  future gateway path: `TrustedDevicePublic`, `PairingToken`, `RemoteSinkId`,
  `RemoteCommandPolicy` (the W4 §3 "WebUI capability subset" allow/deny lists),
  `PushSink` interface. No implementation, no host import. This is the leaf
  contracts package; it stays runtime-light.

### 5. What this ADR does NOT do

- No Host Server implementation, no gateway process, no WebUI, no mobile app,
  no E2EE implementation, no relay, no device-pairing UI, no sync server, no
  cloud session history store.
- No change to the local-only default: `remote.enabled` defaults to `false`,
  the desktop opens no ports, and the host starts no extra listeners when no
  remote sink is attached.
- No second agent loop. A remote client is another `HostClient` over a
  different transport; it sends `HostCommand` and receives `HostPush` like the
  desktop renderer.
- No PTY over remote by default. `allowPtyRemote` defaults to `false`; remote
  PTY is a follow-up (ipc-transport-discipline R10 sanctioned-exception table
  already notes "remote PTY would need its own design").

## Consequences

- The future implementation follows ADR 0036: first make the Host Server,
  client transport, auth, replay, and snapshot seams real; add a Gateway only
  when private direct connectivity is insufficient.
- Every `HostPush` variant carries two optional fields (`seq`, `eventId`).
  Existing tests and consumers are unaffected; the ipc shape test gains cases
  for the new fields and the `host/replay` command.
- `HostRuntime` gains a public multi-sink surface. The legacy `onPush` option
  is preserved (it is registered as the default sink), so `host serve` and
  tests that construct `HostRuntime` with `onPush` keep working.
- `commandHostServe` is refactored to use `JsonlStdioTransport`. Behavior is
  identical; the readline/JSONL framing just moves behind an interface. The
  dispatcher, stream batcher, and shutdown sequence are unchanged.
- `PiwinConfig` gains an optional section. Config loaders that ignore unknown
  keys are unaffected; the doctor/validate path will treat `remote` as a
  recognized key with defaults.
- ADR 0036 is now the implementation decision for Host deployment and
  multi-client behavior. This ADR remains the historical protocol-seam record.

## Reference notes (Cindy, for the future implementer)

The following Cindy designs are the ones worth borrowing when W4 is actually
built. They are **not** adopted by this ADR; they are recorded here so the
future implementer does not have to re-derive them.

- **QR pairing + trusted device store**: one-use token (10 min TTL), device
  secret hash dedup, revoke/remove. Maps to `TrustedDevicePublic` /
  `PairingToken` in `remote.ts`.
- **E2EE v2**: X25519 + ChaCha20-Poly1305 + transcript binding. Optional under
  `remote.e2ee`; only needed for public-internet paths, not LAN or
  self-hosted-over-VPN.
- **Snapshot gate (epoch + version + tombstone)**: piwin's `seq`-based replay
  is the transport-level equivalent. A session-tab *content* snapshot gate is a
  future WebUI concern, not a host-protocol concern.
- **Coalescer**: merge frequent push frames to avoid a stringify storm. piwin
  already has `host-serve-stream-batcher.ts`; a gateway transport can reuse the
  same pattern.
- **Cindy Cloud dependencies to NOT borrow**: account OAuth, app-server quota
  push, heartbeat, SkillHub. piwin is self-hosted; the gateway is the user's
  own server, and quota/heartbeat are out of scope.

## Rejected alternatives

- **Implement the gateway now.** Rejected: W4 is gated behind W1–W3 core work
  (`product-status.md`), and the spec itself says ADR-before-code. Building it
  now would block on PTY/process/permission maturity that is still settling.
  The seams are cheap and unblock later.
- **Gateway as the mandatory execution path.** Rejected by ADR 0036 because it
  adds an unnecessary service to private LAN/VPN deployments and risks making
  the relay a second authority. Gateway remains an optional transport layer.
- **A second wire protocol for remote.** Rejected: violates
  ipc-transport-discipline R8 (no Pi shapes on the wire) spirit and throws away
  the transport-agnostic discipline already enforced. One protocol, many
  transports.
- **Per-session `seq` on `HostPush`.** Rejected: reconnect needs to know what
  the *socket* missed, not what one session missed. Per-session ordering is
  already the job of `AgentEventEnvelope.sequence`. Transport `seq` is host-wide.

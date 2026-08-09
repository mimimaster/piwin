# ADR 0036: Host Server as the multi-client deployment authority

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-08-08 |
| Related | [`specs/host-server-multi-client.md`](../specs/host-server-multi-client.md), ADR 0003, ADR 0006, ADR 0013, ADR 0015, ADR 0017, ADR 0027 |

## Context

piwin currently has a strong local boundary: Tauri/CLI shells use a Product
Host, and only `@piwin/agent-host` crosses into Pi. The remote design in ADR
0027 was written as a personal Gateway where a Desktop dials out and a mobile
client controls the same local agent.

The product target is broader and should be fixed before implementation starts:

- the Node Host must be deployable on the user's Mac, Windows/Linux machine,
  NAS, or server;
- Desktop, Windows, mobile, CLI, and future Web shells must connect to the same
  Host;
- MCP, model providers, projects, permissions, sessions, and other OS-facing
  capabilities remain on the Host machine;
- local one-machine use must remain simple and must not require a Gateway;
- Tailscale/private LAN/WireGuard or a user-operated tunnel should be enough
  for private remote access, with a Gateway as an optional relay.

## Decision

### 1. Host-first topology

`@piwin/host-runtime` is the product execution authority. A deployable Host
Server wraps it with transport, authentication, client admission, push fan-out,
replay, health, and lifecycle management. The first implementation is
`@piwin/host-server` plus `apps/host`, using a loopback/private WebSocket and a
token gate; pairing/revocation and persistent target configuration remain
follow-up slices.

The primary topology is:

```text
Client shell → Host Server → HostRuntime → agent-host → Pi
```

The Host Server may run as a local Tauri sidecar or as a standalone process on
another machine. The client shell and Host may be installed together, but they
are separate responsibilities and communicate through the same contracts.

### 2. One Host, many clients

For one configured Host data root, there is one authoritative Host process. A
client does not create a local copy of a session runtime merely because it is a
second device. Session state, Run/Job authority, Pi backends, MCP supervisors,
permissions, and secrets remain Host-owned.

Multi-client synchronization means push fan-out, replay, and snapshot
hydration. It does not introduce multi-master replication or a second Agent
loop.

### 3. Local, private remote, and hybrid modes

- **Local**: Desktop or CLI starts a local Host sidecar over JSONL, a loopback
  socket, or loopback WebSocket. No external listener is required.
- **Private remote**: a Host Server listens only on a private network or a
  protected tunnel. Other shells connect using the same HostClient protocol.
- **Hybrid**: the Host machine runs a local shell while other shells connect to
  that Host remotely.

Tailscale, Headscale, WireGuard, SSH forwarding, and similar tools are network
deployment options, not product execution layers.

### 4. Gateway is optional and non-authoritative

ADR 0027's Gateway remains a supported relay/NAT pattern, but it is no longer
the primary remote architecture. A Gateway may forward authenticated transport
frames or provide bounded reconnect buffering. It must not import Pi, execute
Host tools, own sessions, store provider keys, or become a second transcript
authority.

### 5. Protocol and security requirements

The Host Server reuses `HostCommand`, `HostResponse`, and `HostPush`. Before a
remote client is considered supported, the protocol must add or implement:

- protocol version and Host instance identity;
- device/client identity and Host-side command policy;
- transport sequence, bounded replay, replay-too-old, and snapshot hydration;
- idempotent mutation/run acceptance semantics;
- per-client session/push subscriptions and bounded backpressure;
- Host-issued logical project/session/asset references instead of client-built
  Host absolute paths.

Private networking does not replace application authentication. Secrets remain
Host-side and are never logged or echoed through a Gateway.

### 6. Capability split

Host capabilities are deployable backend capabilities: Pi, model calls, MCP,
filesystem, Git, browser, process, Jobs, media, and session persistence. Client
capabilities are presentation and local OS capabilities. Interactive PTY remains
Tauri-local under ADR 0013 until a separate remote PTY design is accepted.

## Consequences

- A future `apps/host` or `@piwin/host-server` becomes the deployable Host entry
  point; it composes the existing `@piwin/host-runtime` rather than adding a
  second product runtime.
- A public `@piwin/host-client` / `@piwin/host-transport` surface is needed so
  Desktop, CLI, Windows, mobile, and Web do not each implement transport logic.
- `docs/specs/host-server-multi-client.md` is the implementation authority and
  defines the phased delivery order.
- The old Desktop → Gateway → mobile flow remains possible as an optional
  compatibility topology, but it is not the definition of "remote Host".
- No change is made to the local-only default: a local install opens no network
  listener unless the user explicitly enables one.

## Rejected alternatives

- **Gateway as the primary execution service** — rejected because it moves
  secrets and Agent authority away from the Host and prevents simple private-LAN
  deployments.
- **One independent HostRuntime per client** — rejected because Runs, sessions,
  MCP processes, permissions, and transcripts would diverge.
- **Replicate `~/.piwin` between devices** — rejected for the first deployment
  model; the Host is the source of truth and clients use protocol-level state.
- **A new remote-only wire protocol** — rejected; all transports reuse the
  normalized Host protocol.

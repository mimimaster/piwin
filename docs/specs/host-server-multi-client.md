# Host Server & Multi-client Deployment

| Field | Value |
|-------|-------|
| Status | **Accepted target — initial implementation in progress** |
| Date | 2026-08-08 |
| Authority | ADR 0036; this document is the implementation spec |
| Related | [`architecture.md`](../architecture.md), [`adr/0027-personal-remote-gateway-seams.md`](../adr/0027-personal-remote-gateway-seams.md), [`w4-remote-gateway.md`](./w4-remote-gateway.md), [`multi-client-concurrency.md`](./multi-client-concurrency.md) |

## 1. Intent

piwin is a shell around one private, user-owned Agent Host. The Host is a
deployable execution and data authority. Desktop, Windows, mobile, CLI, and
future Web clients are presentation shells that connect to a Host; they do not
create a second agent loop or own a second copy of the session state.

The product must support all of these without changing the product protocol:

1. **Local single-machine mode** — a Tauri shell starts a local Host sidecar;
   the user experiences one app and no remote setup.
2. **Private remote mode** — a Host runs on a Mac, Linux machine, NAS, or
   server; clients connect over Tailscale/Headscale, WireGuard, a private LAN,
   SSH forwarding, or another user-operated tunnel.
3. **Hybrid mode** — the machine running the Host has a local shell while
   other Desktop, Windows, mobile, or CLI shells connect to the same Host.

## 2. Terminology and authority

### HostRuntime

`@piwin/host-runtime` remains the product composition root. It owns Settings,
commands and pushes, Runs, Jobs, permissions, Host tools, prompt preparation,
runtime generations, and application services.

### Host Server

The Host Server is the deployable process wrapper around `HostRuntime`. It owns:

- transport listeners/connectors (local JSONL, loopback WebSocket, private
  WebSocket, and future tunnel transports);
- client authentication, device identity, command admission, and subscriptions;
- request correlation, push fan-out, replay, and reconnect state;
- Host lifecycle, health, protocol version, and capability negotiation.

The Host Server does not replace `HostRuntime`; it makes the existing
composition root reachable by more than one client.

### Client shell

A client shell owns UI, local input, notifications, and client-specific OS
integration. It consumes public `@piwin` contracts and a transport-neutral
HostClient. It never imports Pi packages and never accesses Host filesystem
paths directly.

### Gateway / tunnel

A Gateway or tunnel is an optional network access layer. It may provide NAT
traversal, outbound dialing, TLS termination, buffering, or a private route,
but it does not import Pi, execute Host tools, hold provider keys, or become a
second session authority.

## 3. Deployment topology

### Local mode

```text
Tauri / CLI shell
        │ local JSONL, loopback socket, or loopback WebSocket
        ▼
Host Server sidecar
        ▼
HostRuntime → agent-host → Pi
```

### Private remote mode

```text
Mac / Windows / Mobile / CLI shell
        │ HostCommand / HostPush over private network or tunnel
        ▼
Host Server on Mac / Linux / NAS / server
        ▼
HostRuntime → agent-host → Pi
```

### Optional relay mode

```text
Client shell ──► Gateway / relay ◄── outbound Host connector ──► Host Server
```

The relay mode preserves the earlier personal-gateway use case. It is not the
canonical execution topology and must not force every deployment to run a
Gateway.

## 4. Host-owned state and capabilities

The Host machine is the source of truth for:

- `~/.piwin` product state and `~/.pi/agent` native Pi state;
- providers, secret references, model configuration, and permissions;
- sessions, transcripts, plans, Runs, Jobs, and runtime generations;
- project roots, Git worktrees, Skills, Extensions, Prompts, and MCP config;
- browser sessions, managed processes, generated media, and artifacts.

Clients receive summaries, events, and bounded resource content through Host
commands. They must not sync the config directory or session files directly.

"Multi-client sync" means one Host authority with fan-out, replay, and snapshot
hydration. It does not mean multi-master replication, CRDT editing, or merging
independent Host databases.

Host capabilities and client capabilities are separate. For example, a remote
Host may run MCP, Git, browser, and non-interactive Jobs, while a particular
mobile shell may only render their state. Interactive PTY remains a separate
capability: ADR 0013 currently makes it Tauri-local, so remote PTY requires a
new Host transport design before it is advertised remotely.

## 5. Protocol invariants

The product wire protocol remains `HostCommand` / `HostResponse` / `HostPush`.
Transports may change; the command and push semantics do not.

Required Host Server protocol work before remote clients are considered usable:

1. `protocolVersion`, `hostInstanceId`, and capability flags are exposed by
   `host/status`.
2. Every accepted long operation has a stable request/run identifier and is
   safe to inspect after a reconnect. Retrying a command must not duplicate a
   prompt, create, or mutation.
3. Transport-level push sequence numbers are assigned by the Host before
   fan-out. They remain distinct from per-session `AgentEventEnvelope.sequence`.
4. Reconnect supports `lastSeq` replay, reports when the requested cursor is
   too old, and provides a snapshot/hydration path instead of silently
   claiming continuity.
5. Push sinks have bounded queues and per-client filtering. A slow or broken
   mobile client cannot block the Host or starve local clients.
6. Client subscriptions and session access are evaluated at the Host boundary;
   a relay must not be the only authorization layer.

The current contracts and multi-sink seam are preparatory only. The missing
runtime behavior is tracked by the implementation phases below.

## 6. Security model

Private networking reduces exposure but does not replace application
authentication. A Host Server must still authenticate a client/device and
enforce its policy at command and push boundaries.

- Pairing uses short-lived enrollment material and revocable device identity.
- Authenticated connections receive a Host-side principal and capability ceiling.
- Remote policy defaults deny secret editing, extension installation, process
  start, destructive operations, and remote PTY until explicitly designed.
- Provider keys and resolved secrets never enter Gateway logs or client pushes.
- TLS is required for non-loopback connections unless the transport's private
  security boundary is explicitly documented and still uses application auth.
- Host paths are opaque Host facts. Remote clients use project/session/asset IDs,
  relative paths under Host-approved roots, or bounded content responses.

## 7. Target package boundaries

```text
apps/desktop, apps/cli, apps/mobile, apps/web
        │
        └── @piwin/host-client + @piwin/host-transport
                    │
                    └── @piwin/contracts

apps/host
        │
        └── @piwin/host-server → @piwin/host-runtime → application packages
                                      └───────────────→ @piwin/agent-host → Pi

apps/gateway (optional)
        └── @piwin/host-transport + @piwin/contracts
            (no HostRuntime, agent-host, or Pi dependency)
```

The exact package names may change during implementation, but the boundaries
are fixed: client shells do not compose the Host, and the Gateway never becomes
the execution authority.

## 8. Implementation phases

### Phase 0 — Make the seams truthful

- Normalize and persist the remote/Host target configuration.
- Add Host instance/protocol capability status.
- Implement sequence assignment, bounded replay, replay-too-old, and snapshot
  hydration contracts.
- Add caller/device context and Host-side remote command policy.
- Add conformance tests for local single-client and multi-sink behavior.

### Phase 1 — Standalone Host Server

- Extract the transport/client abstractions from `apps/cli` and `apps/desktop`
  into public packages.
- Add a `piwin host listen` / `apps/host` entry point.
- Support local loopback transport and a private WebSocket transport.
- Keep the same `HostRuntime` composition root and the same `HostCommand` wire.

### Phase 2 — Private multi-client connection

- Connect a second Desktop/CLI client through a private network.
- Add device pairing/revocation and per-client session subscriptions.
- Verify reconnect, event deduplication, run inspection, permission resolution,
  and transcript hydration.

### Phase 3 — Optional Gateway / tunnel

- Add outbound Host dialing and a relay only if direct private networking is
  insufficient.
- Add health, rate limiting, origin policy, and redacted operational logs.
- Keep the Gateway stateless with respect to Agent execution; any buffering is
  bounded transport buffering, not a second transcript database.

### Phase 4 — Mobile shell

- Reuse the public HostClient and contracts.
- Ship mobile-specific UI and input capabilities only after the Host protocol
  passes the multi-client acceptance tests.

## 9. Non-goals

- Cloud multi-tenancy or shared accounts;
- public-by-default Host exposure;
- replicated or multi-master session stores;
- moving provider keys into a Gateway;
- a second Agent loop per client;
- remote PTY before its own transport and security design.

## 10. Acceptance criteria

The Host Server slice is complete when:

1. A local Desktop shell and a second client can observe the same session from
   one Host process.
2. Both clients use the same normalized commands and pushes; no client parses
   Pi-native events.
3. A disconnected client reconnects without duplicate transcript messages and
   either replays the missing pushes or performs an explicit snapshot hydrate.
4. A client cannot access a command, session, project, or asset outside its
   Host-issued capability ceiling.
5. Host data and secrets remain on the Host machine, and the optional Gateway
   contains no Pi runtime or provider credentials.
6. Local single-machine mode still works with no network listener and no
   Gateway.

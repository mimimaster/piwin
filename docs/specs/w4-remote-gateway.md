# Wave 4 Spec — Host Server · Multi-client · Gateway/Tunnel · Export/Share

| Field | Value |
|-------|-------|
| Status | **Draft — target expanded; implement after Host Server Phase 0** |
| Date | 2026-07-21 |
| Program | [`program-capability-expansion.md`](./program-capability-expansion.md) |
| Prerequisite | Runtime authority, solid PermissionPolicy, Host Server Phase 0 |
| Gate | [`ADR 0036`](../adr/0036-host-server-multi-client-deployment.md) + [`host-server-multi-client.md`](./host-server-multi-client.md) |

## 1. Goals
1. A Host Server can run locally or independently on a private remote machine.
2. Desktop, Windows, mobile, CLI, and future Web shells connect to the **same
   Host authority** and session state.
3. Optional Gateway/tunnel access works without moving Agent execution or keys
   out of the Host.
4. **Export/share** transcripts (local first; optional gateway share token).

## 2. Constraints
- Local Desktop/CLI works fully offline without a Gateway or network listener.
- API keys, projects, sessions, MCP, and Agent execution stay on the Host.
- Gateway does not execute tools, import Pi, own sessions, or store provider keys.
- Private LAN/Tailscale/Headscale/WireGuard is a valid remote transport without
  a Gateway.
- All shells use HostCommand/HostPush; there is no second Agent loop.

## 3. CE-HOST Multi-client Host Server
### Topology

```text
Local:
  Desktop/CLI shell → Host Server sidecar → HostRuntime → agent-host → Pi

Remote:
  Desktop/Windows/Mobile/CLI shell
      → private network or optional Gateway/tunnel
      → Host Server → HostRuntime → agent-host → Pi
```

The earlier Desktop → Gateway → mobile flow remains a supported relay pattern,
but it is not the definition of the Host. The Host Server is the execution and
data authority.

### Protocol
Reuse HostCommand/HostPush JSON first (not Protobuf). Local JSONL and private
WebSocket are first transports. Optional Gateway channels may use
`/ws/v1/host` and `/health`, but the Gateway only forwards authenticated
transport frames.

The Host Server must expose protocol version, Host instance identity,
capabilities, client/device identity, bounded subscriptions, and the same
request/push semantics on every transport.

### Auth and policy

Private networking is not the only security boundary. Host-side device pairing,
revocation, authentication, command admission, and session subscriptions are
required. Bearer tokens, origin allowlists, TLS, and rate limits are transport
controls; the Host remains the policy authority.

### WebUI capability subset
Allowed by default for a trusted client: session list/create/prompt/abort,
permission resolve, plan view, memory search/read, process list/logs/stop.
Denied by default: raw secret edit, untrusted extension install, PTY unless allowPtyRemote, process_start without confirm, memory delete without confirm.
The Host applies a per-device capability ceiling at the command and push
boundaries. Settings sync is redacted; new secrets are sent only to the Host
and never persisted or logged by a Gateway.

### Reconnect

The Host assigns transport-level seq numbers before fan-out. Clients reconnect
with `hostInstanceId` and `lastSeq`; the Host replays from a bounded buffer or
returns an explicit replay-too-old result requiring session snapshot hydration.
Seq is distinct from the per-session `AgentEventEnvelope.sequence`.

Accepted mutations and runs require idempotent request/run identifiers so a
lost response cannot cause a duplicate prompt or session creation.

### Implementation default

`apps/host` / `@piwin/host-server` is the primary deployable Node/TS service,
sharing `@piwin/contracts` and composing `@piwin/host-runtime`. A future
`apps/gateway` is optional and may depend on transport/contracts only. Docker,
Tailscale, or a reverse tunnel are deployment choices, not execution layers.

### Accept

1. Desktop alone works with a local Host sidecar and zero network listener.
2. A second client observes and controls the same session through one Host
   process over a private transport.
3. A 10-second disconnect either replays missing pushes or explicitly hydrates
   from Host state; it never silently duplicates transcript messages.
4. Gateway/tunnel logs never contain provider keys or resolved secrets.
5. The Host can be installed and started independently of any Desktop shell.

## 3.1 Desktop runtime-target chip (product note)

Composer may show a **Local / Remote Host** (本机 / 远程 Host) execution-target control next to the branch chip:

- **Before a remote Host connects:** Remote Host is **visible but disabled (grey)**; hover tooltip **「未连接到远程服务器」** (EN: “Not connected to a remote server”). Local remains the only active target.
- **After a remote Host connects:** Remote Host may become selectable and must rebind session/runtime/tool fall-through to the remote Host — not a cosmetic label flip.
- Tracked as backlog **D-CTX-01 / D-CTX-01a / D-CTX-01b** in [`todo-deferred.md`](../todo-deferred.md). The target is a Host selection, not merely a Gateway connection.

## 4. CE-TUN Tunnel
Expose local port via cloudflared/ngrok skill/CLI (fast path) or Host TunnelManager.
Gateway-path: `/t/<id>` reverse proxy when connected.
Confirm before public expose; TTL; easy stop.

### Accept
Mock or real provider returns public URL; stop invalidates.

## 5. CE-SHARE Export
### Local (ship even if gateway slips)
session export MD/HTML; redact tools option; CLI `piwin session export`.

### Optional share token
enable → token; public read-only; disable revokes; default redact tools.

### Accept
Local MD matches transcript; token only when enabled.

## 6. Config

The existing `remote` block remains the compatibility namespace for optional
Gateway/tunnel settings. The Host target itself is a separate client/runtime
choice and must not be reduced to a boolean Gateway switch. Phase 0 will add a
normalized Host target contract with local/remote mode, Host endpoint, and
transport capability state.

```ts
remote?: {
  gatewayUrl?; tokenRef?; enabled?;
  allowPtyRemote?; allowTunnel?;
}
```
Settings → System → Remote (default off).

## 7. Slices
S0 ADR/spec → S1 Host Server contracts → S2 standalone Host + loopback →
S3 private multi-client → S4 reconnect/snapshot → S5 optional Gateway/tunnel →
S6 Web/mobile shell → S7 export/share token.

## 8. Coordination

Remote clients talk to the same HostCommand/HostPush path and do not own a
second runtime. D-EXT-04 confirmation must relay through the Host. Local
startup remains lazy and offline-safe; a remote Host connection is explicit.

## 9. Open

- Host listener shape: loopback/private WebSocket first; tunnel connector later.
- Client package names (`@piwin/host-client`, `@piwin/host-transport`) and
  standalone entry (`apps/host` vs package binary).
- Remote PTY transport, which remains out of this slice under ADR 0013.
- WebUI/mobile shell packaging after Host protocol acceptance.

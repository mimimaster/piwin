# Wave 4 Spec — Personal Remote Gateway · Tunnel · Export/Share

| Field | Value |
|-------|-------|
| Status | **Draft — implement after W1–W3 core** |
| Date | 2026-07-21 |
| Program | [`program-capability-expansion.md`](./program-capability-expansion.md) |
| Prerequisite | W1 process+session; solid PermissionPolicy; optional W2 PTY |
| Gate | ADR required before code (`docs/adr/00xx-personal-gateway.md`) |

## 1. Goals
1. Optional personal remote: browser WebUI controls the **same local agent**.
2. **Tunnel** to expose local port/ManagedProcess for demos.
3. **Export/share** transcripts (local first; optional gateway share token).

## 2. Constraints
- Desktop fully offline without gateway.
- API keys never stored on gateway — only desktop host.
- Gateway does not execute tools or import Pi.
- Default install opens no ports.
- WebUI is remote presentation of HostCommand/HostPush (no second agent).

## 3. CE-GW Personal Gateway
### Topology
Browser WebUI --WS/HTTP--> Gateway (relay/auth/buffer) --local--> Desktop HostRuntime --> Pi.

### Protocol
Reuse HostCommand/HostPush JSON first (not Protobuf). Channels: `/ws/v1/host`, `/ws/v1/ui`, `/health`.
Recommended NAT: Desktop **outbound** dials user gateway with token.

### Auth
Bearer token via secret ref; origin allowlist; rate-limit failures.

### WebUI capability subset
Allowed: session list/create/prompt/abort, permission resolve, plan view, memory search/read, process list/logs/stop.
Denied by default: raw secret edit, untrusted extension install, PTY unless allowPtyRemote, process_start without confirm, memory delete without confirm.
Settings sync redacted; new secrets typed once on WebUI and sent to desktop.

### Reconnect
Seq numbers on HostPush; gateway ring buffer (~500 events/session); client lastSeq replay.

### Implementation default
`apps/gateway` Node/TS sharing `@piwin/contracts` (Option A). Docker later. Go only if deploy size forces.

### Accept
Desktop alone needs zero gateway; with token browser can stream; 10s disconnect recovers; gateway logs never contain keys; ADR accepted first.

## 3.1 Desktop runtime-target chip (product note)

Composer may show a **Local / Cloud** (本机 / 云端) execution-target control next to the branch chip:

- **Before gateway connect:** Cloud is **visible but disabled (grey)**; hover tooltip **「未连接到远程服务器」** (EN: “Not connected to a remote server”). Local remains the only active target.
- **After gateway connect:** Cloud may become selectable and must rebind Host tool/runtime fall-through to the remote path — not a cosmetic label flip.
- Tracked as backlog **D-CTX-01 / D-CTX-01a / D-CTX-01b** in [`todo-deferred.md`](../todo-deferred.md). Does not replace CE-GW protocol work.

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
```ts
remote?: {
  gatewayUrl?; tokenRef?; enabled?;
  allowPtyRemote?; allowTunnel?;
}
```
Settings → System → Remote (default off).

## 7. Slices
S0 ADR → S1 export → S2 gateway relay+auth → S3 desktop connector → S4 WebUI chat → S5 reconnect → S6 tunnel → S7 share token.

## 8. Coordination
Does not own D-HOST-01b; remote talks same HostCommand. D-EXT-04 confirm must relay. Lazy connect so offline startup stays fast.

## 9. Open
Desktop dial-out vs inbound (prefer dial-out); Node vs Go (default Node); embed WebUI in gateway vs apps/webui.

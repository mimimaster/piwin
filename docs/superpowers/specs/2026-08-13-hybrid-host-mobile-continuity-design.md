# Design: Hybrid Host — Desktop sidecar listen + iOS session continuity

| Field | Value |
|-------|-------|
| Status | Draft — revised direction approved, not implemented |
| Date | 2026-08-13 |
| Authority | ADR 0036 / ADR 0037; this document is the implementation authority for the Hybrid sidecar/mobile-continuity slice and refines the earlier iOS plan where noted |
| Surface | `apps/desktop` sidecar, `@piwin/host-server`, `@piwin/host-runtime` prompt admission, `apps/mobile`, `@piwin/contracts`, `@piwin/project` |
| Related | [ADR 0036](../../adr/0036-host-server-multi-client-deployment.md), [ADR 0037](../../adr/0037-mobile-remote-shell.md), [ADR 0015](../../adr/0015-async-desktop-turn-transport.md), [ADR 0017](../../adr/0017-host-sidecar-bundling.md), [ADR 0048](../../adr/0048-settings-runtime-hot-apply.md), [host-server-multi-client](../../specs/host-server-multi-client.md), [iOS execution plan](../../plans/ios-mobile-shell-execution-plan.md), [mobile sequencing](../../plans/2026-08-12-mobile-deployment-knowledge-sequencing.md) |
| Decision | The packaged Desktop Node sidecar is the Hybrid Host. When the user explicitly enables phone access, that process exposes its existing `HostRuntime` through `HostServer` on an explicitly selected encrypted private-network profile. iOS pairs once, stores a revocable device credential in Keychain, and becomes a second shell on the same Host. Session observation is shared. Every Run mutation carries an explicit Host-checked precondition; replacing a foreground Run is a confirmed, atomic operation rather than an omitted-field compatibility behavior. |

---

## 0. One-liner

电脑开着打包版 Piwin 时，里面那份 Node 就是唯一 Host。手机通过 Tailscale、WireGuard 或用户已经建立的加密隧道连接这份进程，不再起第二套。扫码只负责一次性配对，之后手机用 Keychain 中可撤销的设备凭据重连。两边都能看同一项目和会话；普通发送只在会话空闲时成功，明确点击“中断并发送”才允许替换它刚刚确认过的 `runId`。

---

## 1. Why this slice

The walk-away scenario is:

1. Work in Desktop on this Mac.
2. Leave. The Mac stays awake with Piwin open.
3. Open the iOS shell and continue the same project session.

That is Hybrid mode in ADR 0036 / sequencing §3.3. It is not standalone NAS Host, not a public Gateway, and not “sync `~/.piwin` between devices”.

Today the pieces exist but do not meet in the middle:

| Piece | State |
|-------|--------|
| Packaged Desktop Node sidecar (ADR 0017) | Runs, talks to Desktop over JSONL only |
| `@piwin/host-server` + `apps/host` | Standalone WebSocket Host, separate process |
| `apps/mobile` | Can chat against `apps/host`, but uses a static token and only has a partial continuity projection |
| Desktop “远程 Host” chip | Disabled stub |
| Project session discovery | Remote projection returns opaque `projectId`, but no logical project reference can list that project's sessions |
| Late-join recovery | Hydration has sessions/messages but not active Runs, pending permissions, or checkpoints |
| Session contention | Newer `session/prompt` silently supersedes the in-flight Run |

So a phone connected to `apps/host` and a Desktop connected to its sidecar are two Hosts. Even after topology is joined, static bearer auth, General-only session discovery, incomplete hydration, and silent supersede would still prevent a safe walk-away product.

---

## 2. Goals and non-goals

### 2.1 Goals

1. One Host process, one `~/.piwin` data root, two shells.
2. Desktop remains the zero-setup product: local JSONL sidecar unchanged when phone access is off.
3. A trusted local sidecar-control command starts/stops the existing `HostServer` against the live `HostRuntime`; Desktop Rust never creates a second Host.
4. The first supported phone path is an explicitly selected encrypted private-network profile: Tailscale, WireGuard, or a user-operated encrypted tunnel. Plain LAN `ws://` is not a supported profile.
5. Pairing uses a short-lived, one-time enrollment token that is exchanged for a revocable per-device credential. iOS stores the credential in Keychain.
6. iOS can discover and continue General and project-scoped sessions using Host-issued logical project references; it never sends Host absolute paths.
7. Opening a session is observation. Prompt / abort / permission / steer do not invent a device lease, but every Run mutation carries the exact identity it is allowed to affect.
8. A normal prompt is “send only if idle”. “Interrupt and send” is a separate, user-confirmed request naming the exact Run to replace.
9. Prompt admission is serialized per session. Host validates the candidate before cancelling an existing Run, then compares and reserves ownership atomically.
10. Reconnect and late join restore active Runs, pending permissions, checkpoints, and bounded transcript state before the client becomes actionable.
11. Closing Desktop, stopping phone access, or sleeping the Mac honestly disconnects the phone. Always-on Host is a later slice on the same protocol.

### 2.2 Non-goals (this slice)

- Standalone `apps/host` as the daily driver, or Desktop attaching as a remote client.
- Plain-LAN remote access without WSS/TLS, public bind, public Gateway, custom E2EE relay, or APNs.
- A polished multi-user/device administration console. A minimal paired-device list and revoke action are required.
- Remote PTY, Skill/MCP editors, secret editors, provider setup, or permanent permission-rule editing on the phone.
- Copying Desktop layout into `apps/mobile`.
- Migrating Desktop off its local JSONL transport onto `@piwin/host-client`. Desktop must still adopt the same prompt/run preconditions in this slice.
- Device-exclusive session ownership or kicking another shell to read-only.
- Automatically restoring the external listener after a Desktop/sidecar restart.

---

## 3. Topology and authorities

```text
iPhone (apps/mobile)
        │  @piwin/host-client + WebSocket
        │  encrypted private route + device credential
        ▼
Mac Desktop package
   Tauri UI ── trusted local JSONL ── bundled Node sidecar process
                                      │
                                      ├── HostRuntime   ← only execution/data authority
                                      ├── HostServer    ← optional remote admission door
                                      └── mobile-access controller
                                          ← local control only
```

Rules:

- There is exactly one `HostRuntime`, one Run authority, and one data root.
- Desktop UI keeps the local JSONL transport. WebSocket is another admission door, not another Agent loop.
- The Node sidecar wrapper owns `HostServer` and the local mobile-access controller. `HostRuntime` does not become a network-listener manager.
- Desktop Rust remains the sidecar supervisor. It does not bind the remote port or become the Host.
- Phone never imports Pi, starts Node, or sees Host absolute paths.
- Network access is off at every sidecar process start. No port opens until the local user explicitly enables it.
- `hostInstanceId` identifies the sidecar process/Host authority. Stopping and restarting only the listener does not change it; restarting the sidecar does.
- Authentication creates a Host-side device principal and fixed mobile capability ceiling. Client-provided `clientType` or `clientId` is metadata, not authorization.

This is ADR 0036 Hybrid mode: one server process with multiple shells. It is not a relay-as-authority design.

---

## 4. Supported network profile and Desktop listener control

### 4.1 First supported network profile

The first supported Hybrid Host deployment is deliberately narrow:

- Tailscale or Headscale interface selected explicitly; or
- WireGuard interface selected explicitly; or
- Host bound to loopback while a user-operated encrypted tunnel exposes it.

> **Superseded 2026-09-26 by [ADR 0076](../../adr/0076-bundled-phone-access-lan.md):**
> the bundled app now binds `0.0.0.0` and picks a LAN/tailnet address
> automatically; only the QR endpoint must be non-wildcard and non-public.

The controller must refuse:

- wildcard binds such as `0.0.0.0` / `::`;
- automatic “current LAN address” selection;
- a normal Wi-Fi/Ethernet LAN address without an accepted WSS/TLS deployment profile;
- an address that no longer belongs to the selected encrypted interface;
- a public interface.

The Host can enforce only the **bind face**: loopback, an explicitly selected Tailscale/Headscale/WireGuard interface, or a later accepted WSS/TLS profile. It cannot prove that a user-operated tunnel (SSH, Tailscale Serve, cloudflared, …) is encrypted end to end. Tunnel encryption is a documented deployment convention, not a Host-checked invariant.

Raw `ws://` is allowed only when the process binds to one of those accepted faces. A token alone never makes a normal LAN bind safe. A later WSS profile may add ordinary LAN support with a trustworthy certificate story.

### 4.2 Product control

Desktop Settings or a small pairing sheet exposes:

- **允许手机连接** — off at every sidecar start; not automatically restored across launches in this slice.
- Selected safe network profile/interface.
- `bindAddress` (where `HostServer` listens) and a separate `advertisedEndpoint` (what the phone dials).
- Listener state: off / starting / listening / stopping / failed.
- A short-lived one-time pairing QR, created on demand.
- Authenticated connection count and a minimal paired-device list.
- Revoke action for each paired device.

QR and the manual field publish `advertisedEndpoint`, never `bindAddress` by itself. Loopback-plus-tunnel therefore binds `127.0.0.1` but the QR carries the Tailscale/MagicDNS/tunnel URL the phone can actually reach. If the operator has not supplied a reachable advertised URL, pairing material is not shown.

When the switch turns off:

1. stop accepting new sockets;
2. close existing remote sockets with an explicit “phone access disabled” reason;
3. keep paired device records, so re-enabling access does not require re-pairing;
4. invalidate unused pairing tokens.

“重新生成二维码” invalidates only unused enrollment tokens. It does not revoke already paired devices. Revocation is a separate explicit action.

### 4.3 Local-only sidecar control

Add contracts-first `LocalMobileAccessCommand` / response types for the trusted JSONL control lane:

```ts
type LocalMobileAccessCommand =
  | { type: 'mobile-access/status' }
  | { type: 'mobile-access/start'; profileId: string; advertisedEndpoint?: string }
  | { type: 'mobile-access/stop' }
  | { type: 'mobile-access/create-pairing-code' }
  | { type: 'mobile-access/list-devices' }
  | { type: 'mobile-access/revoke-device'; deviceId: string };
```

These are not remote `HostCommand`s. The bundled Node sidecar wrapper intercepts them before normal `HostRuntime.handleCommand`; `HostServer` never accepts them from WebSocket clients.

The controller owns one `HostServer` instance for the sidecar lifetime so listener toggles preserve `hostInstanceId`, replay/idempotency state where applicable, and device authentication state. Port conflicts, missing interfaces, or bind validation failures return a structured local error and leave the switch off.

---

## 5. Pairing and device authentication

### 5.1 Enrollment material

QR / manual payload contains only:

- `advertisedEndpoint` (phone-reachable WebSocket URL, not the Host bind address);
- `hostInstanceId`;
- `protocolVersion`;
- high-entropy one-time pairing token;
- expiry, default 10 minutes.

Host stores only the pairing-token hash, creation/expiry time, and consumed flag. The token is invalid after its first successful use, expiry, listener shutdown, or explicit QR regeneration.

### 5.2 Exchange for a device credential

Pairing flow:

1. Phone connects through the accepted encrypted network profile.
2. Phone sends the one-time pairing token and a locally generated `deviceId` plus display name.
3. Host verifies token hash, TTL, one-time state, rate limits, and selected network profile.
4. Host creates a cryptographically random device credential and a Host-side principal with the fixed mobile capability ceiling.
5. Host stores only the credential hash and device metadata under `~/.piwin`; raw credential is returned once.
6. Phone writes the credential to iOS Keychain before considering pairing complete.
7. Host consumes the pairing token immediately.

Future reconnects use `deviceId + deviceCredential`, not the pairing token. Authentication compares credential hashes safely, verifies that the device is not revoked, and derives the Host-side principal. The credential is long-lived until revoked; it is never a provider secret and never leaves the encrypted route.

For this Hybrid slice, this refines the iOS execution plan's earlier HMAC-challenge sketch: protocol v2 uses one opaque high-entropy bearer device credential inside the accepted encrypted route, while Host stores only its hash. Do not add a custom challenge protocol whose verifier would require storing the raw shared secret.

Keychain save/read/delete and app-restart behavior are release gates, not follow-ups. Ordinary WebView/local storage may hold endpoint, `deviceId`, display preferences, and replay cursors, but never the device credential.

### 5.3 Revocation and abuse bounds

- Revoking a device immediately closes all of its active sockets and rejects future handshakes.
- Authentication and pairing have bounded attempts, connection count, handshake timeout, and per-source throttling.
- Pairing token, device credential, provider keys, prompt bodies, and Host paths are never logged.
- Static shared `authToken` remains a development/standalone compatibility seam, but it does not qualify a client as a supported iOS Hybrid client.

---

## 6. Project and session discovery

### 6.1 Host-issued project references

`project/list` returns remote-safe entries:

```ts
type RemoteProjectSummary = {
  projectId: string;
  displayName: string;
  trust: 'trusted' | 'untrusted' | 'unknown';
};
```

Add a query-only logical scope contract separate from the durable path-owning `SessionScope`:

```ts
type SessionListScopeRef =
  | { kind: 'general' }
  | { kind: 'project'; projectId: string }
  | { kind: 'all-authorized' };
```

`@piwin/project` / HostRuntime owns stable `projectId` resolution. Before session listing, Host resolves the logical reference to a currently registered project root and rechecks the caller's capability ceiling. `@piwin/session` continues to receive its internal path/scope filter; clients never construct that path.

### 6.2 Required mobile list behavior

- Mobile recent sessions use paged `all-authorized` listing and show the project display name where relevant.
- Project drill-in uses `{ kind: 'project', projectId }`.
- General sessions use `{ kind: 'general' }`.
- Pages are bounded; removing the current `slice(0, 8)` must not replace it with an unbounded complete list.
- Direct `session/resume` and all mutations revalidate that the session belongs to an authorized General/project scope. Possessing or guessing a `sessionId` is not authorization.

This logical reference path is required for the walk-away scenario: most real coding sessions are project-scoped.

---

## 7. Session observation and mutation model

### 7.1 Observation is shared

An authenticated, authorized shell may:

- list allowed projects and sessions;
- resume/read an allowed session;
- subscribe to pushes for selected sessions;
- inspect active Run projections for those sessions.

Two shells opening the same session is the intended walk-away state. Opening a session does not lock it or evict the other shell.

Connection-owned subscriptions are real egress filters, not hydration hints only. A slow or unrelated mobile client must not receive an unbounded copy of every Host push.

### 7.2 Prompt admission expresses intent

Protocol v2 replaces nullable/omitted `expectedForegroundRunId` with a required discriminated precondition:

```ts
type PromptForegroundAdmission =
  | { kind: 'if-idle' }
  | { kind: 'replace-run'; runId: string };

type SessionPromptCommand = {
  type: 'session/prompt';
  sessionId: string;
  input: PromptInput;
  foreground: PromptForegroundAdmission;
};
```

Semantics:

- Normal Send always uses `{ kind: 'if-idle' }`, even if the client already knows a Run is active.
- Only the explicit “中断并发送” confirmation uses `{ kind: 'replace-run', runId }`.
- There is no omitted legacy meaning in protocol v2.
- Bundled Desktop, CLI callers, mobile, Host-authored resume flows, and internal plan seams must all send an explicit precondition.
- A v2 mobile client refuses to control a Host that does not advertise `foregroundRunAdmission`; it never silently falls back to old supersede behavior.

This makes “I observed run-A” different from “I explicitly authorize replacing run-A”.

### 7.3 Admission table

| Client admission | Host actual | Result |
|------------------|-------------|--------|
| `if-idle` | no Run | Accept and start a new Run |
| `if-idle` | `run-A` | Reject `foreground-run-mismatch`; do not mutate |
| `replace-run(run-A)` | `run-A` | Atomically reserve replacement, register the new Run, ack immediately, and cancel `run-A` in the background |
| `replace-run(run-A)` | `run-B` | Reject `foreground-run-mismatch`; do not mutate |
| `replace-run(run-A)` | no Run | Reject `foreground-run-mismatch` with reason `already-finished`; do not auto-send |

The client may offer a new normal Send after `already-finished`, but it must not blindly loop. If another Run appears, Host rejects again and the user sees the new conflict.

### 7.4 Atomic Host admission

Prompt replacement is one Host-owned, per-session serialized transaction:

1. Validate the durable session and authorization.
2. Validate all side-effect-free candidate input: attachment ownership/size, model, orchestration scheme, checkpoint state, and protocol fields.
3. Enter the per-session admission gate.
4. Compare the foreground precondition and reserve the session transition for exactly one request.
5. Register exactly one new foreground Run under the reservation.
6. Return the quick Run acknowledgement with that new `runId`. Do not wait for the provider or MCP abort to finish.
7. If replacing, request cancellation of the named previous Run on the existing bounded cleanup/quarantine path after the ack.

No existing Run is cancelled before candidate validation and reservation succeed. Concurrent CAS hits cannot both win. Other prompts that observe a reserved or cancelling transition receive `foreground-run-mismatch` with reason `transitioning`, not an accidental `run-active` string.

Cancel has a bound. If the old Run does not reach a terminal state in time, it stays quarantined and cannot remain the admitted foreground Run. “中断并发送” must not block on a slow model/tool abort. The new Run is already the admitted foreground Run once step 6 returns.

### 7.5 Other mutations

Do not invent a device/session lease. Use the identity already owned by each operation, and require it for every protocol-v2 client mutation:

| Command | Required identity | Rule |
|---------|-------------------|------|
| `session/abort` | exact `runId` | Missing/mismatch rejects; stale Stop never cancels a newer Run. |
| `session/steer` | exact `runId` | Missing/mismatch rejects. |
| `session/follow_up` | exact `runId` | Missing/mismatch rejects. |
| `session/pause` | exact `runId` | Missing/mismatch rejects. |
| `session/resume-run` | exact `checkpointId` | Existing checkpoint ownership rules remain. |
| `session/discard-checkpoint` | exact `checkpointId` | Replaces the legacy “abort with no Run clears whatever checkpoint exists” behavior. |
| `permission/resolve` | `requestId` | Any authorized shell may resolve the live request once; stale id fails. Mobile may use `rememberScope: 'once'` only. |

Desktop must use the same identities. Compatibility behavior that interprets a missing Run or checkpoint ID as “whatever is current” must not remain in protocol v2.

### 7.6 Stable supersede terminal

Add a stable Run terminal reason/code such as `superseded-by-new-prompt`. Desktop and mobile render localized copy from that code. They never infer supersede by parsing an English terminal message or treating it as a crash.

---

## 8. Structured failure contract and protocol capability

Current `HostResponse` failure has only a display string. Protocol v2 adds an optional structured problem while preserving `error` for generic/legacy display:

```ts
type HostProblem = {
  code: string;
  retryable?: boolean;
  data?: unknown;
};

type FailedHostResponse = {
  success: false;
  error: string;
  problem?: HostProblem;
};
```

For prompt conflict, `problem` is typed and remote-safe:

```ts
type ForegroundRunMismatchProblem = {
  code: 'foreground-run-mismatch';
  data: {
    reason: 'active' | 'changed' | 'already-finished' | 'transitioning';
    actualRun?: {
      runId: string;
      status: 'queued' | 'running' | 'cancelling';
      phase?: SessionRunPhase;
      revision?: number;
    };
  };
};
```

Clients branch on `problem.code`, not `error` text. HostServer applies structured redaction/bounds to problem data just as it does to successful remote responses.

Protocol v2 / capability summary must advertise at least:

- device credential authentication;
- foreground Run admission;
- logical project references;
- activity hydration;
- structured Host problems;
- scoped idempotency.

The bundled Desktop sidecar and Desktop UI ship together on the new contract. A mobile client connecting to a protocol-v1/static-token Host shows an upgrade-required state rather than enabling unsafe mutation.

Implementation must update ADR 0015, or add a focused follow-up ADR, in the same commit series that lands protocol v2. ADR 0015's old `run-active` wording and the current silent-supersede code cannot remain competing truths.

---

## 9. Idempotency and retries

Idempotency stays distinct from Run admission:

- foreground admission asks whether the session still has the expected Run;
- `idempotencyKey` asks whether this exact device operation already executed.

Rules for every remote mutation:

1. One deliberate user action creates one `idempotencyKey`.
2. Transport timeout/reconnect retries reuse that key.
3. Host scopes records by `(devicePrincipalId, idempotencyKey)` and binds them to a canonical command digest.
4. Host reserves the key before executing, so concurrent duplicate frames join one in-flight result instead of both running.
5. Same key + different command digest rejects as `idempotency-conflict`.
6. Completed result is returned again without re-executing.
7. Records survive listener stop/start inside the same sidecar process and are retained for a bounded period for that process lifetime.

This slice does **not** require reconciling in-flight mutations across a Host/sidecar process crash. After `hostInstanceId` changes, the phone full-hydrates; a retry with an old key is not automatically replayed. Crash-durable idempotency (`idempotency-outcome-unknown`, persist-and-reconcile) is a follow-up.

A rejected `if-idle` prompt followed by a user-confirmed `replace-run` prompt is a new deliberate action with a new key because its mutation intent changed. A network retry of either action reuses that action's original key.

---

## 10. Late join, replay, and hydration

### 10.1 Required snapshot

Reconnect and replay-too-old hydration must include bounded, remote-safe projections of:

- Host status/capabilities;
- paged recent sessions and logical project display metadata;
- subscribed session transcript tails;
- active foreground Runs with `runId`, status, phase, and revision;
- pending permission requests for subscribed/authorized sessions;
- active pause checkpoints;
- `snapshotSeq` and `hostInstanceId`.

The snapshot never includes provider secrets, Host paths, raw MCP/Skill configuration, or unrestricted tool output.

### 10.2 Ordering

1. Authenticate device and establish principal.
2. Send Host hello/capabilities.
3. Pause that client's live egress.
4. Build and send hydration at `snapshotSeq` when required.
5. Apply replay strictly after `snapshotSeq`.
6. Release the live tail.
7. Only after the client has atomically applied hydration/replay may it show an actionable `ready` state.

If `hostInstanceId` changes, discard the old cursor and perform full hydrate. Do not stitch sequence spaces across Host processes.

Session subscriptions must affect both hydration and live egress. The mobile client updates its subscription when the selected session changes. A bounded global active-Run summary may be included for navigation, but full session pushes remain filtered.

### 10.3 Required recovery cases

Tests must cover joining after the original `run/updated` has left the replay window while the Run is:

- preparing before first token;
- tool-running;
- waiting-permission;
- cancelling;
- paused with a checkpoint.

In every case the phone receives the correct Run/request/checkpoint identity before Stop, confirm-send, or permission actions are enabled.

---

## 11. Remote command and resource policy

Do not treat the existing type allowlist as the complete policy. The Host-side mobile principal has a fixed, payload-aware ceiling for this slice.

Allowed:

- remote-safe Host/project/session status and paged reads;
- logical project/session discovery;
- prompt with required foreground admission and bounded text/attachments;
- abort/steer/follow-up/pause with exact Run identity;
- resume-run or discard-checkpoint with exact checkpoint identity;
- one-time permission resolution;
- bounded small-image upload and tool/result observation needed by the conversation.

Denied:

- provider/secret changes;
- permanent permission/project allow rules;
- extension/Skill/MCP install, activation, or editing;
- process start and PTY;
- arbitrary Host filesystem/path commands;
- project removal, session deletion, and other destructive lifecycle operations;
- Host/network/device administration over the remote socket.

Every allowed command revalidates payload bounds and resource ownership. Authentication alone does not authorize an arbitrary session, asset, project, Run, or permission request.

Small-image upload returns an opaque asset ID bound to the device principal and target session. The Host-owned media mapping must survive listener restart; it cannot depend only on an in-memory `assetId → absolutePath` map. Prompt admission revalidates asset ownership and resolves the path internally before native image content reaches Pi.

---

## 12. Client UX

### 12.1 Desktop

- Mobile-access switch, safe profile status, pairing QR, connection count, minimal paired-device list, and revoke.
- Switch starts off after each sidecar process start.
- Desktop composer adopts the same `if-idle` / confirmed `replace-run` behavior. It does not silently supersede a phone Run.
- A terminal reason `superseded-by-new-prompt` renders as “任务被另一台设备发送的新消息中断”, not as a crash.
- Listener/bind/auth failures are visible and leave phone access off.

### 12.2 iOS

Reuse the current cockpit, but minimal pairing and secure credential storage are now part of this slice. Inbox, complete Settings, and a polished device manager remain later.

Required behavior:

- Scan a one-time QR or enter the same enrollment material manually.
- Persist endpoint/device metadata normally and device credential in Keychain only.
- Say “已连接到这台 Mac 的 Host”; never imply a local phone Agent.
- Use paged General + project-scoped session lists; remove the current eight-row truncation.
- Apply hydration before enabling controls.
- Normal Send uses `if-idle`.
- `foreground-run-mismatch` with an active Run shows “电脑正在处理这个会话，发送会中断当前任务” → 取消 / 中断并发送.
- Confirm sends `replace-run(actualRunId)` with a new idempotency key.
- If that Run ended or changed before confirmation lands, do not auto-interrupt the replacement. Show the new state or offer a fresh normal Send.
- Stop/steer/pause controls are disabled until the exact live `runId` is known.
- A paused checkpoint shows explicit Continue / Discard actions using its exact `checkpointId`; normal Send remains blocked until one of those actions succeeds.
- Permission card is disabled until the exact live `requestId` is known; mobile always resolves with `rememberScope: 'once'`.
- Foreground reconnect uses last cursor + hydrate/replay. Do not pretend the WebSocket survives iOS suspension.

Full Markdown/tool/diff/artifact presentation, camera workflow, Inbox, and APNs remain later. Text, bounded existing small-image flow, Run status, and permission card are enough to prove continuity.

---

## 13. Lifecycle

| Event | Phone/Host behavior |
|-------|---------------------|
| Pairing token expires | Enrollment fails; create a new QR. Existing paired devices are unaffected. |
| Pairing token succeeds | Token is consumed immediately; phone stores device credential in Keychain. |
| Desktop switch off | Listener closes sockets with an explicit reason; paired device remains registered. |
| Device revoked | Its sockets close immediately; stored credential can no longer authenticate. |
| Desktop quit / sidecar exits | Phone disconnects; Host execution authority is gone. |
| Desktop restarts | Phone access starts off; `hostInstanceId` changes. After local re-enable, the existing non-revoked credential may reconnect and must fully hydrate. |
| Mac sleeps | Socket dies; on wake the user must have Desktop/sidecar active and phone access enabled. |
| Phone backgrounds | Socket is disposable. On foreground, reconnect and hydrate/replay. |
| Listener toggles in one sidecar process | `hostInstanceId` stays stable; unused pairing tokens are invalidated on stop. |
| Host process restarts | `hostInstanceId` changes; discard old sequence cursor and full hydrate. |

Product copy must say: 这台电脑上的 Piwin 关掉、休眠，或关闭“允许手机连接”后，手机会断开。常驻 Host 是下一档。

---

## 14. Package boundaries

```text
apps/desktop
  └── trusted local JSONL
        └── bundled Node sidecar wrapper
              ├── LocalMobileAccessController
              ├── HostServer (optional listener)
              └── HostRuntime (only execution/data authority)

apps/mobile
  └── @piwin/host-client + @piwin/host-transport
        └── protocol v2 HostCommand / HostPush / pairing frames

@piwin/project + @piwin/host-runtime
  └── Host-issued projectId resolution → registered internal project scope

@piwin/contracts
  ├── LocalMobileAccessCommand
  ├── device pairing/auth/principal projections
  ├── PromptForegroundAdmission
  ├── structured HostProblem
  ├── activity hydration
  └── logical SessionListScopeRef
```

Forbidden in this slice:

- `apps/mobile` importing `apps/desktop/src`;
- a second `HostRuntime` on the Mac;
- Desktop Rust binding the Host WebSocket itself;
- phone constructing Host paths;
- using `clientType` as an authorization decision;
- static shared token qualifying as supported mobile pairing;
- plaintext normal-LAN support;
- remote access to the local mobile-access controller;
- widening `packages/artifact` or Desktop chrome merely to make mobile work.

---

## 15. Delivery order

Hard order. Do not start Inbox or visual polish before the Host door is safe and truthful.

1. **Contracts / protocol v2** — device pairing/auth frames, capability flags, `PromptForegroundAdmission`, structured problems, logical project scope refs, activity hydration, exact mutation identities, stable supersede terminal reason. Update protocol fixtures.
2. **Host prompt admission** — side-effect-free validation before cancellation; per-session serialized reservation; table in §7.3; all local/internal callers updated. Update ADR 0015 or add the focused follow-up ADR.
3. **Remote security authority** — one-time pairing token, hashed credential store, device principal/revoke, fixed mobile capability ceiling, payload policy, rate/connection limits.
4. **Recovery and logical resources** — projectId session discovery, active Run/permission/checkpoint hydration, real subscriptions, same-process scoped idempotency across listener stop/start, durable media asset resolution.
5. **Sidecar listener control** — local-only controller starts/stops `HostServer` on the live runtime, preserves process `hostInstanceId`, validates bind-face profiles, keeps `bindAddress` and `advertisedEndpoint` distinct, and exposes structured listener/device status.
6. **Desktop UX/conformance** — switch/QR/devices/revoke, explicit foreground prompt behavior, supersede terminal copy, Desktop JSONL + WebSocket two-client tests.
7. **Mobile pairing/join** — Keychain credential adapter, protocol-v2 connection, paged project/General sessions, hydrate-before-ready, conflict confirmation.
8. **Walk-away smoke** — Desktop project prompt in flight → phone joins after replay window → watches Run/permission state → normal Send is rejected → confirm exact Run → Desktop gets structured supersede terminal → phone continues without duplicate mutation.

Standalone `apps/host` remains the later always-on option. It must use the same protocol-v2 device, mutation, recovery, and logical-resource contracts before it is advertised as a supported mobile target.

---

## 16. Acceptance

Engineering complete (automated, blocks merge):

1. Desktop/sidecar starts with phone access off and no external listener.
2. Enabling phone access refuses wildcard, public, and ordinary LAN binds; it accepts only an explicit loopback / Tailscale / Headscale / WireGuard bind face. The controller does not claim to have verified tunnel encryption.
3. Pairing QR / manual payload uses `advertisedEndpoint`, not `bindAddress`. Missing advertised URL yields no pairing material.
4. A short-lived one-time QR exchanges for a revocable device credential; pairing token reuse/expiry fails. Keychain adapter is unit-tested; iPhone Keychain is the release gate below.
5. Revoking the device closes its sockets and blocks future reconnect.
6. Desktop with phone access on serves the same sidecar `HostRuntime`; `apps/host` is not required and no second root owner exists.
7. Hydration after replay-too-old restores the live Run/phase, pending permission or checkpoint before controls become active (fake Host + two-client tests).
8. Merely watching or opening an in-flight Desktop Run never cancels it.
9. Normal phone/Desktop Send during a live Run returns structured `foreground-run-mismatch` and does not mutate anything.
10. Confirming `replace-run(run-A)` acks a new `runId` without waiting for provider abort, then supersedes only `run-A`. If current state is idle or `run-B`, it rejects without touching `run-B`. Slow cancel leaves the old Run quarantined and other prompts see `transitioning`.
11. Invalid candidate input does not cancel the existing Run.
12. Two concurrent matching replacement requests produce one winner and one stable conflict; never two accepted foreground Runs.
13. Abort/steer/follow-up/pause with a missing or stale Run ID cannot affect a newer Run; resume/discard with a stale checkpoint ID cannot affect a newer checkpoint.
14. A network retry with the same idempotency key returns the same result and does not duplicate prompt/create/permission mutation, including across listener stop/start in the same sidecar process.
15. Desktop receives `superseded-by-new-prompt` as a structured terminal reason and clears its spinner without treating it as a crash.
16. Switch off disconnects the phone honestly. A new sidecar process starts with phone access off; after local re-enable a non-revoked device reconnects, detects the new `hostInstanceId`, and fully hydrates. Crash-durable idempotency is not required.
17. The mobile device cannot persist project permission rules or call secret, extension activation, process, PTY, destructive lifecycle, or mobile-access administration commands.
18. `pnpm typecheck`, touched-package tests, protocol fixtures, admission concurrency tests, auth tests, recovery tests, and the in-repo two-client smoke pass.

Release gate (real iPhone, does not block the engineering checklist above):

- The selected encrypted-network profile actually reaches a physical iPhone.
- Keychain survives app restart; revoke on the Mac blocks that phone.
- Walk-away smoke: Desktop project prompt in flight → phone joins → watches Run/permission → normal Send rejected → confirm exact Run → Desktop shows structured supersede → phone continues.

---

## 17. Follow-ups (explicitly later)

- Standalone always-on Host as a normal Desktop/mobile target.
- Crash-durable mutation idempotency across Host/sidecar process restart, including `idempotency-outcome-unknown` reconciliation.
- Normal-LAN WSS profile with certificate provisioning/trust UX.
- Credential rotation, richer device naming/audit, and per-device configurable capability ceilings.
- Desktop as a remote client of a standalone Host (D-CTX-01b).
- Persist/auto-restore listening only after a safe profile and explicit product policy are accepted.
- Optional `expectedGenerationId` for workflows that must also pin runtime generation.
- Public Gateway/tunnel, custom relay E2EE if later justified, and public-internet hardening.
- Mobile Inbox, full Markdown/tool/diff/artifact presentation, camera/file upload tickets, and APNs.

These follow-ups reuse the same Host authority, device principal, logical-resource, mutation-precondition, idempotency, and hydration contracts. They are not shortcuts around them.

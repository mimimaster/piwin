# Design: Hybrid Host — Desktop sidecar listen + iOS session continuity

| Field | Value |
|-------|-------|
| Status | Draft — approved direction, not implemented |
| Date | 2026-08-13 |
| Surface | `apps/desktop` sidecar, `@piwin/host-server`, `@piwin/host-runtime` prompt admission, `apps/mobile`, `@piwin/contracts` |
| Related | [ADR 0036](../../adr/0036-host-server-multi-client-deployment.md), [ADR 0037](../../adr/0037-mobile-remote-shell.md), [ADR 0015](../../adr/0015-async-desktop-turn-transport.md), [ADR 0017](../../adr/0017-host-sidecar-bundling.md), [ADR 0048](../../adr/0048-settings-runtime-hot-apply.md), [host-server-multi-client](../../specs/host-server-multi-client.md), [iOS execution plan](../../plans/ios-mobile-shell-execution-plan.md), [mobile sequencing](../../plans/2026-08-12-mobile-deployment-knowledge-sequencing.md) |
| Decision | The packaged Desktop Node sidecar is the Hybrid Host. When the user enables phone access, that same `HostRuntime` also serves the existing Host Server WebSocket. iOS is a second shell on that process. Session views are shared. Mutations use Host-owned compare-and-swap on the foreground run, not a device-level session owner. |

---

## 0. One-liner

电脑开着打好包的 Piwin 时，里面那份 Node 就是 Host。手机连的是这份进程，不是再起一套。两边都能看同一会话；要改会话（发、停、点权限）必须对上当前 `runId`，对不上就拒绝并说明，不能再静默顶掉。

---

## 1. Why this slice

The walk-away scenario is:

1. Work in Desktop on this Mac.
2. Leave. The Mac stays awake with Piwin open.
3. Open the iOS shell and continue the same session.

That is Hybrid mode in ADR 0036 / sequencing §3.3. It is not standalone NAS Host, not a public Gateway, and not “sync `~/.piwin` between devices”.

Today the pieces exist but do not meet in the middle:

| Piece | State |
|-------|--------|
| Packaged Desktop Node sidecar (ADR 0017) | Runs, talks to Desktop over JSONL only |
| `@piwin/host-server` + `apps/host` | Standalone WebSocket Host, separate process |
| `apps/mobile` | Can chat against `apps/host` |
| Desktop “远程 Host” chip | Disabled stub |
| Session contention | Newer `session/prompt` silently supersedes the in-flight run |

So a phone connected to `apps/host` and a Desktop connected to its sidecar are two Hosts. The walk-away path is blocked by topology, not by missing chat UI.

---

## 2. Goals and non-goals

### 2.1 Goals

1. One Host process, one `~/.piwin` data root, two shells.
2. Desktop remains the zero-setup product: local JSONL sidecar unchanged when phone access is off.
3. An explicit Desktop switch starts the existing `HostServer` on the same `HostRuntime`.
4. iOS joins over the private Host protocol already implemented (`HostClient` + WebSocket).
5. Opening a session is observation. Prompt / abort / permission / steer do not invent a device lease.
6. Prompt admission is CAS on the foreground run, matching ADR 0048’s generation CAS style.
7. Closing or sleeping Desktop honestly drops the phone. Always-on Host is a later slice on the same protocol.

### 2.2 Non-goals (this slice)

- Standalone `apps/host` as the daily driver, or Desktop attaching as a remote client.
- Full pairing ceremony (device secret, Keychain, revoke UI). Token-in-QR is enough.
- Public bind, Gateway, E2EE relay, APNs.
- Remote PTY, Skill/MCP editors, secret editors on the phone.
- Copying Desktop layout into `apps/mobile`.
- Migrating Desktop off its local JSONL `HostClient` onto `@piwin/host-client`.
- Device-exclusive session ownership / kicking the other shell to read-only.

---

## 3. Topology

```text
iPhone (apps/mobile)
        │  HostClient + WebSocket
        │  token from QR / manual field
        ▼
Mac Desktop (apps/desktop)
   Tauri UI ── JSONL ── bundled Node sidecar
                          │
                          ├── HostRuntime   ← only execution authority
                          └── HostServer    ← only when “允许手机连接” is on
```

Rules:

- There is still exactly one `HostRuntime` and one data root.
- Desktop UI keeps the local sidecar transport. The WebSocket is an extra admission door, not a second Agent loop.
- Phone never imports Pi, never starts Node, never sees Host absolute paths.
- Default remains: no network listener. Enabling the switch is the only way a port opens.

This is the same shape OpenCode uses (one process is the server; other clients attach) and the shape ADR 0036 already named Hybrid. It is not Cindy-style relay-as-authority.

---

## 4. Desktop listen surface

### 4.1 Product control

Desktop Settings (or a small pairing sheet) exposes:

- **允许手机连接** — off by default, persisted in Desktop-local preferences, not as a Host-wide “I am a public server” flag.
- When on: start `HostServer` against the live sidecar `HostRuntime`.
- When off: stop the listener; existing phone sockets close.
- Show the reachable URL(s), a short-lived join token, and a QR.

Recommended first bind: Tailscale / current LAN address. Loopback-only is useless to a phone. Non-loopback already requires a token in `HostServer`; keep that invariant.

### 4.2 Implementation constraint

The sidecar process that already owns `HostRuntime` must construct `HostServer`. Do not spawn a second Node Host against the same `~/.piwin`. The existing session runtime lease is there to stop two Host processes, not two shells.

Desktop Rust stays sidecar supervisor. It does not become the Host.

### 4.3 What the phone is allowed to do

Reuse `HostServer`’s current remote allowlist. This slice does not widen it to secret edit, extension install, process start, or PTY.

---

## 5. First join (v1)

v1 pairing is a join token, not a device credential store.

QR / manual payload contains only:

- WebSocket endpoint
- `hostInstanceId`
- `protocolVersion`
- short-lived token
- expiry

Phone stores endpoint + token in ordinary app storage for this slice. Keychain, HMAC challenge, revoke-one-device, and “this Mac’s trusted device list” stay on the existing iOS plan as the next security slice.

Host already rejects missing/wrong tokens. Rotate the token when the user taps “重新生成”. Old QR dies.

Do not put provider keys, `~/.piwin` paths, or the long-lived Desktop session cookie into the QR.

---

## 6. Session model

### 6.1 Observation is free

Any authenticated shell may:

- `session/list` / `session/resume` / `session/messages`
- subscribe to pushes for a session
- watch an in-flight run

Two shells on the same session is the intended walk-away state. Opening a session does not lock it and does not evict the other shell.

### 6.2 Mutation is CAS

The Host is the compare-and-swap authority. The token is the **current foreground `runId`**, or `null` if none.

This is the same idea as ADR 0048 (generation id is the CAS token for runtime replacement) and the contracts comment on `session/reload-runtime`. It is not a new lock service.

Idempotency stays separate: `idempotencyKey` means “this same request retried”. CAS means “a new request may only land if the world is still what the client saw”.

### 6.3 Why not exclusive owner

The operator is one person moving devices. Exclusive owner would add lease, expiry, steal, and “Desktop is now read-only” for a problem the Host already solves at run granularity. ADR 0036, W4, and the iOS plan all say observe-and-control. Polpo-style takeover is recorded as reference only.

---

## 7. Prompt CAS contract

### 7.1 Wire

`session/prompt` gains:

```ts
expectedForegroundRunId?: string | null;
```

Meaning is fixed; the contracts field uses this name.

- omitted: **legacy**. Current sidecar Desktop may omit. Host keeps today’s supersede behaviour for that caller so local Desktop does not break in this slice.
- `null`: client believes there is no foreground run.
- `"run_…"`: client believes that run is the foreground run.

`apps/mobile` always sends the field. It never uses the legacy omit path.

Optional later: `expectedGenerationId` if a stale shell must not start a turn on a replaced runtime. Not required to ship the walk-away path.

### 7.2 Host admission

| Client expected | Host actual | Result |
|-----------------|-------------|--------|
| `null` | no run | Accept, start new run |
| `run-A` | `run-A` | Accept. If this is a new user prompt, **explicitly** supersede `run-A`, then start the new run |
| `null` | `run-A` | Reject `cas-mismatch` |
| `run-A` | `run-B` | Reject `cas-mismatch` |
| `run-A` | no run | Reject `cas-mismatch` (run already finished or aborted) |
| omitted (legacy) | any | Existing silent supersede (Desktop local only for this slice) |

`cas-mismatch` is a stable, branchable error. Response includes the actual `runId` (or none), phase if any, and a short reason. Phone uses that to render the confirm sheet, then retries with the actual id.

This resolves the ADR 0015 vs code drift:

- ADR 0015 text: second prompt is `run-active`.
- Current code: newer prompt always supersedes.
- This spec: supersede only when the client CAS-hits the live run (or is a legacy omitter). Otherwise reject.

Implementation must update ADR 0015 (or add a small follow-up ADR) in the same change that lands the field. Do not leave two written truths.

### 7.3 Other mutations

Do not invent a second CAS token.

| Command | Existing identity | This slice |
|---------|-------------------|------------|
| `session/abort` | optional `runId` | Keep. Aborting `run-A` while `run-A` is live is already CAS. Mismatch stays `run-mismatch`. |
| `permission/resolve` | `requestId` | Keep. Any trusted shell may resolve the live request. Resolving a stale id already fails. |
| `session/steer` / `follow_up` | require live run | Keep. They already fail without a foreground run. |
| `session/pause` / `resume-run` | checkpoint + `run-active` | Unchanged. |

Phone Stop on the live run is allowed without a “takeover” step. That is how you leave the desk while a turn is hanging.

---

## 8. Client UX

### 8.1 Desktop

- Switch + QR sheet as in §4.
- Connection count is enough (“手机已连接”); no device name required in v1.
- If the phone supersedes a Desktop run, Desktop already receives `run/terminal` / abort reason. Show it as “被更新的消息中断”, not as a crash.
- Composer on Desktop may keep omitting `expectedForegroundRunId` in this slice.

### 8.2 iOS

Reuse the current cockpit. Do not build Inbox / Settings / pairing Keychain in this slice.

Required honesty:

- Connected to **this Mac’s Host**, not a fake local agent.
- Session list is the Host list (more than 8 rows; current `slice(0, 8)` is a bug relative to this spec).
- If send returns `cas-mismatch` with a live run: sheet “电脑正在处理这个会话，发送会中断当前任务” → 取消 / 中断并发送.
- Confirm retries the same text with `expectedForegroundRunId` set to the Host’s actual id.
- If mismatch because the run ended: retry once with `null`.
- Reconnect stays lastSeq / snapshot. No new recovery machine.

Markdown / tool cards / camera ticket upload stay later. Text + existing small image + permission card is enough to prove continuity.

---

## 9. Lifecycle

| Event | Phone sees |
|-------|------------|
| Desktop switch off | disconnect, not “Host crashed mysteriously” |
| Desktop quit | same |
| Mac sleep | socket dies; on wake, user must have Desktop up again |
| Phone background | existing reconnect + lastSeq; do not pretend WS survives iOS suspend |
| Host process restart | `hostInstanceId` change → full hydrate, do not stitch seq |

Copy must say: 这台电脑上的 Piwin 关掉或休眠后，手机连不上。常驻 Host 是下一档。

---

## 10. Security

- Listener off by default.
- Non-loopback requires token (already enforced).
- Remote command allowlist unchanged.
- Remote projections stay path-redacted.
- Token is join material, not a provider secret. Do not log it.
- Tailscale / LAN / WireGuard is the network; it does not replace the token.
- TLS for raw public internet is out of scope. If the bind is not a private interface, refuse or require an explicit “I understand” later — v1 documents private-network only.

---

## 11. Package boundaries

```text
apps/desktop
  └── sidecar HostRuntime
        └── HostServer (optional listener)
              └── existing remote projection / egress / allowlist

apps/mobile
  └── @piwin/host-client + @piwin/host-transport
        └── HostCommand / HostPush

contracts
  └── expectedForegroundRunId + cas-mismatch
```

Forbidden in this slice:

- `apps/mobile` importing `apps/desktop/src`
- second `HostRuntime` on the Mac
- phone constructing Host paths
- widening `packages/artifact` or Desktop chrome to “make mobile work”

---

## 12. Delivery order

Hard order. Do not start Inbox UI before the Host door exists.

1. **Contracts** — `expectedForegroundRunId`, `cas-mismatch` (+ current run snapshot in the error payload). Tests for the table in §7.2. Legacy omit path covered.
2. **HostRuntime** — prompt admission implements the table. Explicit supersede only on CAS hit. Update ADR 0015 text in the same commit series.
3. **Sidecar listen** — Desktop switch starts/stops `HostServer` on the live runtime. Token + QR. Two-client test: Desktop JSONL + WebSocket client, same session.
4. **Mobile join** — point the existing cockpit at that URL; persist last endpoint; handle `cas-mismatch` confirm.
5. **Walk-away smoke** — Desktop prompt in flight → phone opens same session → watch tokens → confirm-interrupt → Desktop shows superseded → phone continues after run ends.

Standalone `apps/host` is unchanged and remains the later always-on option. Same phone binary.

---

## 13. Acceptance

This slice is done when:

1. Desktop with phone access **off** still opens no listener.
2. Desktop with phone access **on** serves the sidecar `HostRuntime` over WebSocket; `apps/host` is not required.
3. iOS lists the same sessions as that Desktop and resumes one of them.
4. Watching an in-flight Desktop turn does not cancel it.
5. A phone send without the live `runId` is rejected; confirm supersedes; Desktop sees a clean superseded terminal, not a stuck spinner.
6. A phone send after the run is idle continues the same transcript.
7. Quit Desktop → phone is disconnected. Restart Desktop + re-enable → phone can join again.
8. `pnpm typecheck` and the new CAS / two-client tests pass.

---

## 14. Follow-ups (explicitly later)

- Device pairing + Keychain + revoke (iOS plan Phase 4).
- Desktop as a remote client of a standalone Host (D-CTX-01b).
- Persist listen across Desktop launches only after the switch has a safe default bind story.
- `expectedGenerationId` on prompt.
- Mobile Inbox, Markdown, upload ticket, APNs.

Those reuse this protocol. They are not blockers for the first walk-away path.

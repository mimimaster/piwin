# Mobile cockpit implementation (pairing + listed features)

Status: implementing (Phase 2 Desktop `mobile-access/*`)  
Date: 2026-08-18  
Related: ADR 0036, ADR 0037, [hybrid Host / mobile continuity](../superpowers/specs/2026-08-13-hybrid-host-mobile-continuity-design.md), [hold-to-talk](./2026-08-17-mobile-hold-to-talk.md), [browser token admission worktree](./2026-08-16-browser-host-token-admission.md) (lives on `feat/browser-host-token-admission`), [standalone pairing worktree](./2026-08-15-mobile-pairing-notifications.md) (uncommitted on `feat/standalone-host-multi-client-continuity`)

## 0. Verdict

Do **not** `git merge` either worktree. Both are behind main and would smash Host-runtime / Desktop.

**Surgical transplant** of two already-written admission stories onto current main, then implement the mobile features listed on 2026-08-17 in the same cockpit slice.

| Worktree | What to take | What to leave |
|---|---|---|
| `feat/browser-host-token-admission` (`piwin-wt-browser-token`) | Connect wall → one WebSocket → `client/hello` carries a door token → Host kicks or admits. Origin-local store for **web**. Same-port HTTP is web-only. | Pairing, Keychain, HTTPS. Do not put the Host door token in iOS Keychain as if it were a device secret. |
| `feat/standalone-host-multi-client-continuity` (uncommitted pairing files) | `HostDevicePairing` + file store (hash only), hello enrollment/reconnect, `credential_store.rs` Keychain commands, mobile vault interface. Tests for mint/consume/revoke/bounds. | APNs, notification dispatcher, 81-commit continuity fork, unused HMAC `challenge`, `message.authToken !==` (main already has `timingSafeEqual`). |

Product wrap-up still holds for **Desktop v1**: pairing is not a Desktop merge. This document is a **separate mobile cockpit slice** that copies pairing *code*, not the branch.

## 0.1 Review (2026-08-17)

Direction stands: surgical transplant, one WebSocket, three keys, no merge. Before coding, these holes in the draft are closed below.

Must-fix (would ship a broken phone or a false pairing story):

1. **Mobile send is already rejected on current HostServer.** `handleCommand` requires `session/prompt.foreground`. `apps/mobile` never sends it, and the chat canvas never shows `errorMessage`. Pairing without `foreground: { kind: 'if-idle' }` (and a replace confirm) is a dead cockpit. This is PR1, not a later continuity leftover.
2. **Hold-to-talk auto-send must be `if-idle` only.** A voice release must not `replace-run` a Desktop turn. Busy → surface mismatch on canvas, do not send.
3. **Pairing authority is process-local.** Desktop sidecar and `apps/host` both claim `~/.piwin` (exclusive lease). A token minted by `apps/host` is useless if the phone still talks to a different process. Phase 1 dogfood = phone → the same `HostServer` that minted the QR. Phase 2 Desktop `mobile-access/*` is what makes this a daily-driver feature.
4. **Non-loopback `start()` currently demands `PIWIN_HOST_TOKEN` even if pairing exists.** Change the guard to: beyond loopback, require door token **or** a live pairing store. Paired hello already skips the door token (worktree); the listen-time check must match.
5. **Keychain write failure must retry the issued secret**, not demand a new QR. Host consumed the pairing token at hello and already returned `deviceSecret`. Dropping that secret on disconnect is how you brick a consumed enrollment. New QR only if the secret was never delivered (hello failed / persist rolled back).
6. **Slice 6 has no command.** There is no remote `activity/list`. Inbox as “Host-wide runs” needs a bounded projector (or stay fake). Do not pretend the current `activeRunId` of the open chat is Inbox.

Should-fix:

- Persist after `completePairing` and **before** `host/hello`. Persist failure → roll back in-memory consume, do not send `deviceSecret`.
- Mint / list / revoke stay on the Host operator surface (`apps/host` stdout or later local JSONL). Never a remote `HostCommand`.
- QR `hostInstanceId` is advisory. Mismatch after connect warns; it does not fail pairing (instance id changes on sidecar restart; device credential must not).
- `ws://` pairing only on the hybrid accepted faces (loopback, Tailscale/WG, or operator tunnel). A token does not make raw LAN bind safe.
- Do not copy worktree `challenge`, APNs, or “remote prompt requires idempotency key or close”. Main `HostClient` already mints idempotency keys for mutations.
- `TrustedDevicePublic.secretHash` must not be projected to the phone.

## 1. One door, three keys

Keep a single Host WebSocket. Authentication happens only on `client/hello`. Later commands ride the admitted socket (browser-token worktree rule). Do not add cookies, JWT, or a second WS.

```text
Phone / Web / CLI
    WS  client/hello   ──►  HostServer.acceptHello
                              │
                              ├─ pairingToken          → consume once, mint device secret
                              ├─ deviceCredential      → hash compare, not revoked
                              └─ authToken             → PIWIN_HOST_TOKEN (door password)
                              │
                              ▼
                            host/hello
                            (deviceSecret only on first pairing response)
```

| Path | Who | Client stores | Host stores | Idempotency scope |
|---|---|---|---|---|
| **A. Door token** | Web, CLI, Desktop-as-remote, mobile **dev/LAN fallback** | Web: `localStorage` origin key (`piwin.web.host-credential`). Mobile must not persist this in Keychain. | Env `PIWIN_HOST_TOKEN`. Never hashed because it is an operator-chosen shared secret, not a device principal. | `clientId` (self-reported; compatibility) |
| **B. Pairing enrollment** | Mobile first connect (QR or paste) | Nothing until `host/hello` returns the secret | SHA-256 of one-time token until consumed; then device hash | becomes device id |
| **C. Device reconnect** | Mobile after pairing | Keychain: `{ deviceId, deviceSecret }` keyed by endpoint digest | Device hash + metadata under `~/.piwin` (0600) | Host-issued `deviceId` |

Rules:

- Pairing hello must not also send `deviceCredential` or the door token.
- `clientId` / `clientType` remain metadata. They never authorize.
- Remote allowlist + payload ceiling stay as today. Pairing does not widen `secrets/get`.
- Loopback may still omit a door token (current HostServer). Non-loopback still requires *some* admission (door token **or** paired device).
- Mobile **production** path is B then C. Path A on the phone is a developer override, not the QR product.

Current main QR is Path A in disguise: `barcode-pairing.ts` puts `token` into `authToken` and connects. That is a shared password scan, not enrollment. The parser and connect wall must split `pairingToken` vs `authToken`.

## 2. What already exists (do not rewrite)

**Main today**

- `HostServer.acceptHello`: protocol version, `clientId`, timing-safe `authToken`, replay/hydration.
- `HostClient.createHello`: only `authToken`.
- Mobile connect form + QR that fills endpoint/token.
- Contracts leaf types `PairingToken` / `TrustedDevicePublic` in `packages/contracts/src/remote.ts` (no runtime).
- Hybrid spec §5: QR carries advertised endpoint + one-time token; Host stores hashes; phone Keychain is a release gate.

**Browser-token worktree (copy the pattern, not the branch)**

- Connect wall before any workbench.
- Hello once per socket; tab close drops the socket; reopen hellos again.
- Store is origin-local and cleared on explicit disconnect.
- Token never baked into HTML/JS.

**Standalone worktree (copy these files, then re-type against current contracts)**

- `packages/host-server/src/device-pairing.ts` + tests — bounded mint/complete/authenticate/revoke/export/restore. Drop unused `challenge` (hybrid spec: no HMAC dance; opaque bearer is enough).
- `packages/host-server/src/device-pairing-store.ts` + tests — atomic 0600 JSON, serialized writes.
- `apps/mobile/src-tauri/src/credential_store.rs` — `mobile_credential_read/write/clear`, account = `device-credential.v1.` + sha256(endpoint), never log keyring errors.
- Vault seam in worktree `apps/mobile/src/mobile-host-connection.ts`: Tauri invoke vs in-memory (web/dev). **No localStorage for device secrets.**

Wire `acceptHello` like the worktree (three-path), but keep main’s `authTokensEqual` and current replay/hydration. Do not paste the whole 1900-line worktree `host-server.ts`.

## 3. QR / advertised endpoint

QR JSON v2 (replace today’s `{ endpoint, token, name }`):

```json
{
  "v": 1,
  "endpoint": "wss://mac.tailnet.ts.net:8787",
  "pairingToken": "…base64url…",
  "hostInstanceId": "…",
  "protocolVersion": 1,
  "expiresAt": 1770000000000
}
```

URI form: `piwin://pair?endpoint=…&pairingToken=…&hostInstanceId=…&expiresAt=…`

Issuer (phase 1, dogfood only): the **same** process the phone will dial — typically `apps/host` — prints token + advertised URL (and optional QR) to stdout. Desktop `pnpm dev:tauri` is a different Host (JSONL sidecar, exclusive `~/.piwin` lease). Do not mint on 8787 and expect the sidecar to honor it.

Bind face stays the existing HostServer bind (loopback / explicit private overlay). Advertised endpoint is what the phone dials; it may differ from bind address (Tailscale / SSH tunnel). Refuse to print a pairing QR for a wildcard / plain LAN `ws://` bind.

Issuer (phase 2, this slice): Desktop local JSONL `mobile-access/*` from the hybrid spec. Remote clients must never call those commands. The sidecar intercepts them before `HostRuntime.handleCommand`. Settings → General → 手机接入 toggles a loopback `HostServer` on the same process that holds `~/.piwin`.

`parsePairingString` accepts v2 first. Legacy `{ endpoint, token }` is treated as **door token** (Path A) and labeled in the UI as “Host 口令”, not “配对”.

## 4. Feature slices (implementation order)

Split `use-mobile-host.ts` (972 lines) at the start of slice 1, or the next feature violates the 1000-line cap.

### Slice 1 — Pairing admission (Host + contracts + client)

1. Contracts: `TrustedDeviceCredential`, `PairingCompletion`; `client/hello` optional `pairingToken` | `deviceCredential` | `deviceName`; `host/hello` optional `deviceId` + `deviceSecret` (secret only on enrollment).
2. Copy `HostDevicePairing` + file store into `packages/host-server`. Persist under `~/.piwin/devices/pairing.json` (0600).
3. `HostServer` option `devicePairing`; `apps/host` constructs it. Enrollment persists before `host/hello` returns the secret.
4. `HostClient` hello sends exactly one of the three keys. After enrollment, caller receives `deviceSecret` once via hello handler. Persist pairing state before that hello; persist failure rolls back the in-memory consume.
5. Idempotency scope = paired `deviceId` when present.
6. `HostServer.start()`: non-loopback allowed if `authToken` **or** `devicePairing` is configured.
7. Mobile `session/prompt` always sends `foreground: { kind: 'if-idle' }`. Explicit “中断并发送” is the only `replace-run` path. Tests cover `foreground-required` and `foreground-run-mismatch` on the chat canvas.
8. Tests: token replay, expiry, wrong secret, revoke, pairing+credential rejected together, door-token still works, `secrets/get` still denied.

### Slice 2 — Mobile connect wall + Keychain

1. Rust commands + `tauri-plugin-keyring-store` (or equivalent already used in the worktree). Register in `lib.rs`.
2. Vault: native → Keychain; Vite web → memory only. Endpoint + `deviceId` may live in ordinary storage; secret may not.
3. Connect wall (browser-token pattern): nothing else renders until hello succeeds.
   - Native: Scan QR / paste pairing token → hello Path B → hold `deviceSecret` in memory → Keychain write **before** leaving the wall. If Keychain write fails, keep the issued credential in memory and retry write; do **not** discard it or ask for a new QR. New QR only when hello never returned a secret (auth failed or Host rolled back persist).
   - Reopen app: vault read → hello Path C.
   - Disconnect / “退出此设备”: vault clear. Does not revoke on Host (operator revokes).
4. Update `barcode-pairing.ts` + tests for QR v2.
5. Connection UI copy: stop saying Keychain until the vault is wired.

### Slice 3 — Chat-visible errors

Pass `host.errorMessage` into `ConversationSurface`. Send/upload/permission failures stay on the canvas, not only the connect page. Tiny; do it with slice 2 so pairing failures are visible too.

### Slice 4 — Native capture permissions

`tauri.conf.json` `bundle.iOS.infoPlist`:

- keep `NSCameraUsageDescription`
- add `NSMicrophoneUsageDescription`
- add `NSSpeechRecognitionUsageDescription`

File input: keep album `image/*`, add a camera control with `capture="environment"` (or a small native picker later). Still `media/save` + opaque asset id.

### Slice 5 — Hold-to-talk STT

Per [hold-to-talk plan](./2026-08-17-mobile-hold-to-talk.md). Depends on slice 4 plist. Empty-state mic long-press; `stop()` then wait for finals; then `session/prompt` with `foreground: { kind: 'if-idle' }`. If the session is busy, show the mismatch on the canvas — do not auto-replace. Slide-up cancel. Do not auto-send in `pointerup`.

### Slice 6 — Cross-session Inbox

Needs a new bounded remote command (contracts-first), e.g. `activity/summary`: opaque sessionId, runId, phase, pending permission flag — no Host paths. Today’s Inbox reading `host.activeRunId` is the open chat only and must not be relabeled as Host-wide. Notification/APNs stay out. If the projector is not ready, slip this slice rather than fake it.

### Slice 7 — Artifact card (optional in this batch)

Wire existing `MobileArtifactCard` to transcript artifact events + sandboxed `@piwin/artifact` preview. Default-block external resources. Can slip to the next batch if slice 1–5 slip.

## 5. Explicit non-goals (this batch)

- `git merge` of either worktree.
- APNs / background delivery (worktree Host queue can wait).
- Desktop `mobile-access/*` listener UI — **in progress this slice** (loopback profile only).
- Live voice call / TTS-then-STT.
- Remote PTY, secrets editors, MCP/Skill admin on the phone.
- Treating `PIWIN_HOST_TOKEN` as a per-device credential.
- Storing device secrets in `localStorage` “just for iOS WKWebView”.

## 6. Acceptance

**Pairing**

- Host mints a 10-minute one-use token. Second hello with the same token fails.
- Phone QR → Keychain has `{ deviceId, deviceSecret }`; `~/.piwin/devices/pairing.json` has hash only.
- Kill app, relaunch, auto-hello Path C, same sessions.
- Revoke on Host: next hello 4004; phone shows reconnect/re-pair, vault cleared on explicit exit.
- Web/CLI with door token still connects; `secrets/get` still `command-not-allowed`.
- iOS Web preview without Tauri: pairing secret stays in memory; UI says it will not survive refresh.

**Cockpit**

- Send failure appears on the chat canvas.
- Long-press empty mic → overlay → release → one prompt with transcript; slide-up does not send.
- Camera or album image still becomes an opaque Host asset.
- Inbox badge and list come from `activity/summary` (Host-wide runs + pending permissions). Open-chat `activeRunId` is only the stop button.
- Completed assistant html/svg fences show an Artifact card; preview uses `@piwin/artifact` srcdoc + `sandbox="allow-scripts"` and blocks external resources.

## 7. File ownership (expected)

| Area | Touch |
|---|---|
| `@piwin/contracts` | hello/credential types |
| `@piwin/host-server` | pairing manager, store, `acceptHello` branches |
| `@piwin/host-client` | hello key variants + one-shot secret callback |
| `apps/host` | construct pairing store; mint/print QR material |
| `apps/mobile` | vault, QR v2, connect wall, errors, hold-to-talk, camera, inbox |
| `apps/mobile/src-tauri` | keyring commands, Info.plist |
| Desktop | not in this batch except later `mobile-access` |

## 8. Suggested first PR cut

PR1 = slices 1–3 (admission + Keychain + chat errors) **and** mobile `session/prompt.foreground`. Without the last item, pairing a phone still cannot send.  
PR2 = slices 4–5 (plist + camera + hold-to-talk, if-idle send).  
PR3 = slice 6 only after `activity/summary` exists. Artifact optional.

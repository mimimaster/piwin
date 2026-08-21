# Host ↔ shell connection repair (2026-08-20)

Status: **audit #1–#32 closed**; **2026-08-20 review findings (H1/H2/#9 + medium) fixed and re-verified**.

## Checklist

| # | Issue | Fix | Status | Residual risk |
|---|-------|-----|--------|---------------|
| 1 | Stale Transport cursor on reconnect | HostClient hello uses `this.lastSeq`; `persistCursor` syncs Transport; server clamps future cursors + force hydration; client clamps on hello | **Fixed** | Multi-tab cursor store races |
| 2 | CONNECTING orphan + Tauri queue stall | Transport closes CONNECTING; Tauri generation cancel + 15s connect budget in plugin queue | **Fixed** | Native dial may linger until OS fails after JS timeout |
| 3 | media/read vs 1 MiB frame → 1011 | Wire-safe ~700 KiB media read; oversized response prefers error frame | **Fixed** | No chunked media protocol |
| 4 | Backpressure never resumes | Egress `scheduleDrainRetry` | **Fixed** | Timer drain, not socket `drain` event |
| 5 | Large replay → 4008 loop | Mid-replay re-queue + drain instead of kick | **Fixed** | Large journals still slow |
| 6 | Mobile stop/start same ID, new journal | Rotate `instanceId` on stop; pairing retained | **Fixed** | QR after stop/start uses new id (intended) |
| 7 | Empty journal reports complete | Hub: complete iff `sinceSeq >= currentSeq` or continuous | **Fixed** | — |
| 8 | Ready on host/hello | Ready after replay/done\|snapshot\|hydration; `connect()` awaits catch-up | **Fixed** | Desktop UI may mark shell ready on hello; package state waits |
| 9 | Desktop hydration:false | Keep false; snapshot → emit + `remoteCatchUpEpoch` → re-`hydrateSessions` + idle transcript reload via `useRunReconcile` | **Fixed** | Not a full mobile hydration dump; project trees catch up on epoch clear |
| 10 | Fatal codes still reconnect | 4002/4003/4004/4009 stop auto-reconnect | **Fixed** | — |
| 11 | Host stop no deadline | 2s deadline then `terminate()` | **Fixed** | — |
| 12 | Pairing save fail leaves dead Host | Start catch calls `server.stop()` | **Fixed** | — |
| 13 | Hydration consistency fence | Capture `fenceSeq` before async hydrate I/O; snapshotSeq = fence | **Fixed** | — |
| 14 | No inbound maxPayload | `maxPayload: 1 MiB` | **Fixed** | — |
| 15 | No Host supervisor | `scripts/supervise-host.sh` exponential backoff respawn | **Fixed** | Not systemd/launchd; operator must opt into the script |
| 16 | Replay error keeps in-flight | Clear latch on matching replay error | **Fixed** | — |
| 17 | Hello/replay/command not serialized | Per-connection `ingressTail`; ping bypasses queue | **Fixed** | Non-ping commands still mutual-serialize (stricter than required) |
| 18 | Responses bypass egress backpressure | Command `response` frames go through `sendResponse` (budget wait); pushes/hello/replay still direct `send` | **Fixed** | Protocol `error` frames still direct-send |
| 19 | No server liveness sweep | 15s sweep + ws ping; idle terminate at 90s | **Fixed** | — |
| 20 | Close reason overwritten | Pre-hello closes include `(code): reason` | **Fixed** | — |
| 21 | No build version negotiation | `hostBuildId` / `minClientVersion` on hello; env gates; 4002 if too old | **Fixed** | Desktop/CLI still advertise `0.0.0` until package versions bump |
| 22 | README wss:// vs plain WS | Document cleartext process + TLS at proxy / Tailscale Serve | **Fixed** | — |
| 23 | Cleartext token on LAN | Warn unless `PIWIN_HOST_ALLOW_CLEARTEXT=1` | **Fixed** | Does not hard-refuse (operator override) |
| 24 | Blank `PIWIN_HOST_TOKEN=` | Empty treated as unset | **Fixed** | — |
| 25 | Node 20 CLI WebSocket | `createNodeHostWebSocket` via `ws` | **Fixed** | — |
| 26 | CLI prompt wait forever | 10m timeout on attached + local `run/terminal` wait | **Fixed** | No mid-wait `foreground-run` poll |
| 27 | Endpoint load validation | Desktop + CLI require `ws:`/`wss:` on load/attach | **Fixed** | — |
| 28 | localStorage errors → sticky dead shell | `persistCursor` soft-fails store writes; always syncs Transport; never publishes `error` for quota | **Fixed** | Cursor may not survive reload if storage is broken |
| 29 | Sleep/resume false timeout | Heartbeat resets on large timer skew | **Fixed** | No Desktop `visibilitychange` hook yet |
| 30 | Address/Origin edges | Empty Origin OK; wildcard bind advertises `127.0.0.1` | **Fixed** | Proxy Origin still needs explicit allowlist |
| 31 | Reconnect without jitter | Backoff × [0.5,1.0] jitter | **Fixed** | — |
| 32 | Weak lifecycle logs | `onConnectionEvent` structured one-liners from `apps/host` | **Fixed** | — |

## Review follow-ups (2026-08-20 evening)

| ID | Finding | Fix | Evidence |
|----|---------|-----|----------|
| H1 | `persistCursor` catch published sticky `error` | Soft-fail; always `transport.setLastSeq` | `host-client.ts` + unit test |
| H2 | `replay/done.complete` used pre-fence `initialReplay` | Post-hydration/snapshot `listReplay` → `complete: replay.complete` | `host-server.ts` + hydration/snapshot tests expect `complete: true` |
| #9 overstated | Snapshot only refreshed status | `remoteCatchUpEpoch` → session list + transcript catch-up | bootstrap + App + `use-run-reconcile` tests |
| M1 | Catch-up fail left open socket | `connect()` catch → `transport.close()` | `host-client.ts` |
| M2 | Command responses bypassed budget | All `handleCommand` responses → `sendResponse` | `host-server.ts` |
| M3 | CLI URL not validated | `readCliHostAttachTarget` requires ws/wss | CLI + Desktop load tests |

## Verification (2026-08-20 re-review)

- `@piwin/host-server` 103 tests green (incl. snapshot complete:true)
- `@piwin/host-client` 13 tests green (incl. persistCursor soft-fail)
- `@piwin/host-transport` 20 tests green
- Desktop `use-run-reconcile` + `remote-host-session` + CLI `attach-existing-host` green
- typecheck: host-client, host-server, cli, desktop green

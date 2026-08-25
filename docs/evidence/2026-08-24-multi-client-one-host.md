# Multi-client one-Host convergence evidence

| Field | Value |
|-------|-------|
| Date | 2026-08-24 |
| Scope | Desktop / Mobile / attached CLI → one HostRuntime |
| Related | `docs/plans/2026-08-24-multi-client-one-host-convergence.md` |

## What landed

- One `HostRuntime.getHostInstanceId()` is the composition identity. Sidecar JSONL and phone-access share one `HostEgressHub` and one process-lifetime idempotency registry. Stopping phone-access keeps that identity and hub.
- Caller-owned `HostRequestAttempt` keys on Desktop, Mobile, and attached CLI. Adapters no longer mint mutation keys. Local JSONL uses a versioned envelope (`v`, `command`, `idempotencyKey`, `clientPrincipalId`).
- Shared `reduceForegroundRun` / `applyHostPushToForeground`. `message/end` does not terminalize a Run. A superseded `cancelling` `run/updated` cannot clobber a newer foreground Run (shared projection and Desktop `applyRunRecord`).
- Desktop Send/Stop stay off while the selected session is `unknown` or `reconciling`, including Host-not-ready.
- Attached CLI refuses mutations without a caller-owned key and persists `readCliClientPrincipalId` per Host target. In-process `HostRuntime.handleCommand` is not given a second options argument. `createSideChatHostClient` uses `bindSideChatHostClient` so `piwin side-chat send` keeps the caller-owned key on attached Hosts. Desktop side-chat Send/Stop forward the key and exact `runId`. Attached CLI side-chat send includes `foreground: if-idle`. Archive `session/delete` and pause-then-Send abort carry keys. Desktop admission re-queries on Host-ready and stays `unknown` if `session/foreground-run` fails. Composer Send/Stop are disabled while admission is not `ready`. Desktop `message/end` without `runId` no longer clears an active Host Run.
- Exhaustive `classifyHostPushAudience`. `liveSubscriptions` filters high-rate session pushes; old clients keep full fan-out.
- Queue / replace / dismiss on Mobile matches the Desktop busy-send table.
- `HostServer` hydration/replay lives in `host-server-hydration.ts`; `host-server.ts` is 940 lines.

## Automated evidence

Package tests covering the shipped functions (not a reimplemented reducer):

- `@piwin/host-client` foreground projection + request attempts
- `@piwin/host-server` process-lifetime idempotency, two-client concurrency, live subscriptions, sidecar topology
- `@piwin/mobile` prompt/abort/permission/queue/replace keys
- `@piwin/desktop` live envelope (no adapter mint) + remote reconnect
- `@piwin/cli` JSONL envelope admission

Topology suite (`live-subscriptions`, `sidecar-topology`, `two-client-concurrency`, `multi-client-concurrency`, idempotency registry) was run twice in a row; both runs passed.

Slow-shell isolation: a blocked mobile client with a 2-item queue is disconnected as `slow-consumer` while the desktop client still sees the live Run, then `run/terminal` after abort.

## Soak

A bounded high-rate queue/heap/disconnect soak was not executed in this environment (no dedicated soak harness wired for this change). Do not invent numbers. Existing ADR 0038 hub tests cover slow-consumer disconnect isolation.

## SDK / RPC parity

Foreground and replay cases use mock `HostRuntime` (`mode: 'sdk'`, `mock: true`). A live RPC provider boot was not required for these gates and was not run here.

## Operator diagnostics

Useful counters (payload-free):

- Host identity: `HostRuntime.getHostInstanceId()`, `HostServer.getInstanceId()`
- Production sinks: `HostRuntime.countProductionPushSinks()` (must stay 1)
- Idempotency: `HostCommandIdempotencyRegistry.getStats()` (`inFlight`, `completed`, `replayCount`, `conflictCount`, `capacityCount`)
- Egress: per-client `filteredItems`, `subscriptionCount`, `slowConsumerDisconnects`

Do not log API keys, device secrets, prompt bodies, or raw Host paths in remote diagnostics.

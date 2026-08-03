# Phase 7 RPC Worker Parity — Gap Analysis

**Date:** 2026-08-04 (session review)
**Branch:** `feat/settings-capability-runtime-refactor`
**Plan:** [`phase7-rpc-worker-parity-plan.md`](./phase7-rpc-worker-parity-plan.md)

## Summary

WP0–WP6 are implemented and committed. 885 tests pass, typecheck is green.
The worker backend (`WorkerRpcSessionBackend`) runs real Pi sessions in a
piwin-owned Node worker process with tool proxying to the parent Host.

However, **several gaps remain** before the plan's exit criteria are fully
met. These gaps fall into two categories: (A) architectural wiring that
connects the worker to the HostRuntime capability compilation pipeline,
and (B) protocol robustness features (timeouts, crash semantics, hello
handshake validation).

## What is done (WP0–WP6)

| WP | Status | Commit |
|----|--------|--------|
| WP0 | Plan + ADR updates | `3238751`, `3a1d75b` |
| WP1 | Blueprint/protocol completion | `107bc0b` |
| WP2 | HostToolExecutionRouter extraction | `107bc0b` |
| WP3 | Worker real session create/prompt/event | `88ddd81` |
| WP4 | Tool proxy end-to-end | `bfbaf7d` |
| WP5 | PiSessionBackend dual impl + adapter switch | `414488e` |
| WP6 | Conformance suite | `3dd63be` |
| WP7 | Documented as next step (not executed) | `fd43206` |

## Gaps (must close before R1 rollout)

### GAP-1: HostRuntime → worker blueprint compilation (§8.3)

**What:** `PiRpcAdapter.createSession` uses `deriveBlueprintFromInput()` — a
transitional shim that builds a minimal blueprint with empty resource
paths, no providers, and `snapshotId: 'transitional'`. The plan (§8.3)
requires the HostRuntime to compile the full `SessionCapabilitySnapshot`
via `SessionCapabilityResolver` and project it to `SerializableBlueprint`
before calling the worker backend.

**Impact:** The worker backend currently creates sessions with no skills,
extensions, prompts, or tools. It is functionally a text-only session.

**Fix:** Wire `PiRpcAdapter.createSession` to call
`compileSessionCapabilitySnapshot()` → `projectBlueprintForWorker()` before
delegating to `WorkerRpcSessionBackend`. The adapter needs access to the
`SessionCapabilityResolver` (or the HostRuntime must pass the compiled
blueprint as part of `CreateSessionInput`).

**Priority:** **Critical** — without this, the worker path is not a real
product session.

### GAP-2: Provider runtime envelope not populated (§6)

**What:** `PiRpcAdapter.createSession` passes `providers: []` to the worker
backend. The plan (§6) requires the parent to build
`SerializableProviderRuntime[]` from the live Settings provider config and
pass it to the worker so the worker can register models without loading
`~/.piwin/config.json`.

**Impact:** The worker cannot call any model — no provider registration
happens.

**Fix:** Build the provider envelope from `PiwinConfig.providers` (or the
live `PiModelRuntime`) in the adapter before calling the backend.

**Priority:** **Critical** — without providers, the worker session cannot
prompt.

### GAP-3: Hello handshake not validated by client (§4.3)

**What:** `RpcSdkWorkerClient` does not parse or validate the `hello` frame.
The plan (§4.3) requires the parent to refuse workers that advertise
incompatible `protocolVersion`. The worker emits hello, but the client
ignores it.

**Impact:** A worker with an incompatible protocol version would silently
fail or produce confusing errors instead of a clean rejection.

**Fix:** Add hello frame parsing in `RpcSdkWorkerClient.handleFrame()`.
Store the advertised `protocolVersion` and `capabilities`. Refuse
`createSession` if the version is incompatible.

**Priority:** Medium — important for robustness but not blocking dev use.

### GAP-4: No timeout handling (§4.4)

**What:** The plan specifies timeouts for worker start (5s), session/create
(30s), prompt ack (2s), tool-call roundtrip (10 min), abort (2s). None of
these are implemented in `RpcSdkWorkerClient` or `WorkerRpcSessionBackend`.

**Impact:** A hung worker or tool proxy call could block indefinitely.

**Fix:** Add timeout wrappers around `request()` calls with the specified
durations. Use `AbortSignal` for cancellation.

**Priority:** Medium — important for production but not blocking dev use.

### GAP-5: Crash semantics not implemented (§9.3)

**What:** When the worker process exits unexpectedly, active sessions should
be marked `failed`/`stale` and the host should log an error. Currently
`WorkerRpcSessionBackend` does not handle the worker `exit` event.

**Impact:** A worker crash would leave sessions in an indeterminate state;
the UI would not know the session is dead.

**Fix:** Subscribe to `client.on('exit')` in `WorkerRpcSessionBackend`.
Mark all active sessions as failed. Emit a terminal `AgentEvent` (error)
for each affected session.

**Priority:** Medium — important for production reliability.

### GAP-6: `PIWIN_RPC_SDK_FALLBACK` flag not implemented (§10.1)

**What:** The plan specifies `PIWIN_RPC_SDK_FALLBACK=1` as a temporary flag
to allow the old in-process fallback after the worker becomes default.
This flag is not checked in `PiRpcAdapter`.

**Impact:** Once `PIWIN_RPC_WORKER` becomes default, users cannot force
the old fallback path if the worker has issues.

**Fix:** Add `PIWIN_RPC_SDK_FALLBACK` check in `usesWorkerBackend()` — when
set, return false (use SDK fallback instead of worker).

**Priority:** Low — only needed when worker becomes default (R1).

### GAP-7: `WorkerShutdownFrame` not implemented (§4.1)

**What:** The plan specifies a `shutdown` frame for graceful shutdown
signaling. This frame type is not in the protocol.

**Impact:** Minor — the current `close()` path works, but explicit shutdown
reasons would improve diagnostics.

**Fix:** Add `WorkerShutdownFrame` type and emit it from the worker entry
on `rl.on('close')` before `process.exit(0)`.

**Priority:** Low — nice-to-have for diagnostics.

### GAP-8: Tool family matrix tests incomplete (WP4 task 4)

**What:** WP4 task 4 requires matrix tests covering MCP, web, process,
browser, notes, flashcards, and image_gen tool families. The current
tests cover web_search and bash generically but do not test each family
explicitly.

**Impact:** A regression in one tool family's proxy registration might
not be caught.

**Fix:** Add parameterized tests that verify each tool family name
produces a proxy tool with the correct parameter schema.

**Priority:** Low — the generic tests cover the mechanism; family-specific
tests add confidence.

### GAP-9: Extension UI proxy not implemented (§3.2 authority matrix)

**What:** Under the worker backend, extension `ctx.ui.confirm` and other
extension UI requests are not proxied back to the parent. The ADR 0012
update notes this as a "documented degradation."

**Impact:** Extensions that use UI APIs will fail under the worker backend.

**Fix:** Add an `extension-ui` frame type to the protocol and proxy
extension UI requests from worker to parent. This is a follow-up work
item (WP7 or separate).

**Priority:** Medium — needed for extension parity but not blocking
text-only sessions.

### GAP-10: Worker script path resolution for bundling (§10.3)

**What:** The worker script path uses `import.meta.url` which works in dev
but may break in bundled host packaging. The plan (§10.3) says "worker
script path resolution must not depend on `import.meta.url` alone without
bundle tests."

**Impact:** The worker backend may not work in CLI/desktop production
builds.

**Fix:** Add a `workerScript` option that packaging scripts can set
explicitly. Add a bundle test that verifies the worker script is
resolvable from the bundled host.

**Priority:** Medium — needed for production packaging.

## Recommendations

1. **Before R1 rollout:** Close GAP-1 and GAP-2 (critical). Without
   blueprint compilation and provider envelope, the worker path is not
   a real product session.

2. **Before R1 rollout:** Close GAP-3, GAP-4, GAP-5 (robustness). The
   worker backend needs hello validation, timeouts, and crash semantics
   for production reliability.

3. **R1 → R2 window:** Close GAP-6, GAP-7, GAP-8, GAP-9, GAP-10. These
   are important for full parity but not blocking initial rollout.

4. **WP7 (deletion pass):** Only after all gaps are closed and CI is
   green. Do not delete the SDK fallback until the worker backend is
   validated in staging with real sessions.

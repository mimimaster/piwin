# ADR 0031: MCP Child Process Leak Fix

**Status:** Accepted
**Date:** 2026-08-05
**Supersedes:** None
**Related:** [ADR 0033](./0033-mcp-supervisor-architecture.md)
**Severity:** Critical — ~1.5 GB RSS leaked across 334 orphaned processes

## Context

The `fixture-mcp-server-hanging-connect.mjs` test fixture intentionally never
responds to the MCP `initialize` request and keeps itself alive with
`setInterval(() => {}, 1 << 30)`. When the lifecycle manager's connect
timeout fired, the spawned child process was **never killed**, because:

1. **`closeChild()` sent SIGTERM but never waited for exit or escalated to
   SIGKILL.** A process with an active `setInterval` and no signal handler
   may not terminate promptly from SIGTERM alone.

2. **The lifecycle manager's `withTimeout` rejected on timeout, but the
   underlying `connectionPromise` stayed pending forever** — the fixture
   never responds to `initialize`, so `client.connect()` (official SDK) or
   `send('initialize', ...)` (handcrafted client) never settles. The
   `onTimeout` callback registered `connectionPromise.then((lateClient) =>
   closeWithDeadline(lateClient))`, but since the promise never resolved,
   `closeWithDeadline` was **never called**.

3. **The official SDK's `transport.close()` has SIGTERM → 2s → SIGKILL
   escalation, but `closeWithDeadline` only allowed 2s** — not enough time
   for the SDK's own escalation to complete. The `safeClose` promise was
   abandoned by the `Promise.race` timeout.

4. **No test-level safety net existed** to kill surviving child processes
   after the test suite completed.

Each test run that exercised the hanging-connect fixture leaked 1–2 orphaned
Node.js processes (reparented to PID 1 after vitest exited). Over multiple
test runs across multiple piwin worktrees, this accumulated to **334
orphaned processes consuming ~1.5 GB RSS**.

## Decision

### 1. One shared process-tree close helper

`packages/mcp/src/mcp-process-tree.ts` owns the shutdown sequence used by both
stdio implementations:

- launch the child in a detached process group on Unix;
- send `SIGTERM` and wait up to 2s;
- escalate to group `SIGKILL` and wait up to 3s more;
- use recursive `taskkill` on Windows;
- return only after the sequence completes or its hard deadline is exhausted.

The owner captures the spawned PID before readiness and retains it after the
child's close event.

### 2. Official SDK protocol with piwin-owned transport

`packages/mcp/src/mcp-client-official.ts` uses the official SDK `Client`, but
not the SDK's stock `StdioClientTransport`. `OwnedMcpStdioTransport` keeps the
SDK protocol callbacks while delegating process-group ownership to piwin. This
avoids relying on the SDK's direct-PID close path, which clears its process
reference during shutdown and does not recursively close descendants.

### 3. Lifecycle manager aborts the connection on timeout

`packages/mcp/src/mcp-lifecycle-manager.ts`:

- `startInternal()` creates an internal `AbortController` and passes its
  signal to `connectMcpStdio()`.
- When the connect timeout fires, `abortConnect()` closes the owned transport
  and the pending connection is then awaited by the Supervisor.
- Auto fallback closes and awaits the failed official candidate before starting
  the handcrafted candidate.
- The manager no longer abandons close with `Promise.race`; each owned
  transport supplies its own bounded shutdown contract.

### 4. Unexpected-exit and dispose paths retain the owner

When a running server exits unexpectedly, the Supervisor keeps the exact owner
handle long enough to close the remaining process tree before marking the slot
`error` or starting the one permitted restart. `dispose()` is serialized with
config application, so an in-flight apply cannot reinsert a slot after global
shutdown has cleared the registry.

### 5. Test `afterAll` safety net

`packages/mcp/src/mcp-lifecycle-manager.test.ts`:

- `afterAll` scans for `fixture-mcp-server` processes with `ppid === 1`
  (orphaned) or `ppid === process.pid` and SIGKILLs them.

## Consequences

- No more orphaned MCP fixture processes after test runs.
- Connect timeout now actively kills the entire owned process tree instead of
  hoping the connection promise eventually settles.
- Shutdown can take up to 5s in the worst case (SIGTERM + SIGKILL escalation),
  which is acceptable for a cleanup path.
- The `afterAll` safety net is macOS-specific (`ps` command) but degrades
  gracefully on other platforms (catch block, no-op).

ADR 0033 keeps these fixes as the transport-level baseline and adds the missing
ownership guarantees for config replacement, call-failure cooldown, and Host
shutdown. The test safety net remains useful, but it is not a substitute for
awaited Supervisor cleanup.

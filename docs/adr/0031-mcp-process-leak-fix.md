# ADR 0031: MCP Child Process Leak Fix

**Status:** Accepted
**Date:** 2026-08-05
**Supersedes:** None
**Related:** None
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

### 1. `closeChild()` now waits for exit with SIGKILL escalation

`packages/mcp/src/mcp-client.ts`:

- After `SIGTERM`, wait up to 2s for process exit.
- If still alive, send `SIGKILL` and wait up to 3s more.
- Total hard deadline: 5s.

### 2. Official client captures PID before close, hard-kills after

`packages/mcp/src/mcp-client-official.ts`:

- Both the `close()` method and the connect-error path capture
  `transport.pid` **before** calling `transport.close()` (the SDK clears
  its internal `_process` ref early in `close()`).
- After `transport.close()`, unconditionally `process.kill(pid, 'SIGKILL')`
  as a belt-and-suspenders fallback.

### 3. Lifecycle manager aborts the connection on timeout

`packages/mcp/src/mcp-lifecycle-manager.ts`:

- `startInternal()` creates an internal `AbortController` and passes its
  signal to `connectMcpStdio()`.
- When the connect timeout fires, `abortConnect()` is called, which causes
  the official SDK's `client.connect()` to reject (triggering
  `transport.close()` + SIGKILL) and the handcrafted client's `send()` to
  reject (triggering `closeChild()` with SIGKILL escalation).
- `closeWithDeadline` default timeout increased from 2s to 8s to allow
  SIGKILL escalation to complete.

### 4. Test `afterAll` safety net

`packages/mcp/src/mcp-lifecycle-manager.test.ts`:

- `afterAll` scans for `fixture-mcp-server` processes with `ppid === 1`
  (orphaned) or `ppid === process.pid` and SIGKILLs them.

## Consequences

- No more orphaned MCP fixture processes after test runs.
- Connect timeout now actively kills the child process instead of hoping
  the connection promise eventually settles.
- `closeWithDeadline` takes up to 8s in the worst case (SIGTERM + SIGKILL
  escalation), which is acceptable for a shutdown path.
- The `afterAll` safety net is macOS-specific (`ps` command) but degrades
  gracefully on other platforms (catch block, no-op).

# ADR 0096: Every Desktop quit reaps the Host sidecar; a successor Host stops an orphan

- **Status**: Accepted
- **Date**: 2026-10-20
- **Scope**: `apps/desktop/src-tauri` (`app_shutdown`, `host_bridge` supervisor), `@piwin/host-runtime` (root lease), `apps/cli` (`host serve`)
- **Consults**: ADR 0006 (Desktop ↔ Host transport), ADR 0017 (sidecar bundling)
- **Amended by**: ADR 0100 (lease checks owner identity; ownership failures exit 78 and are not respawned)

## Context

On 2026-10-20 a Dock "Quit" ended `piwin-desktop` in ~10 ms. Only
`WindowEvent::CloseRequested` ran `host_stop`; the macOS `terminate:` path
(Dock Quit, Cmd+Q, the Quit AppleEvent) never did. tao 0.35 does not
implement `applicationShouldTerminate:`, so that path delivers no
`RunEvent::ExitRequested` — only the unpreventable `RunEvent::Exit` from
`applicationWillTerminate:`. The sidecar was reparented to launchd and, under
heavy memory pressure, took ~37 s to finish its stdin-EOF shutdown while still
holding `~/.piwin/.host/owner.lock`.

The next Desktop's Host failed with `piwin root is already owned by process N`
about every 1.1 s (~30 times). The respawner was the Desktop supervisor: a
spawn counts as a successful restart, the new Host dies on the lease, stdout
EOF starts a *new* supervisor, and its backoff starts again at 500 ms — an
unbounded loop.

## Decision

1. **One teardown, every quit path** (`app_shutdown.rs`).
   - `CloseRequested` and `ExitRequested` both call `begin_graceful_shutdown`,
     which prevents the native close/exit, runs the observed teardown once
     (MCP/PTY snapshot → `pty_close_all` → `host_stop` → `ShutdownReport`),
     then closes the window or calls `app.exit(code)`. An exit request during
     a window-close teardown upgrades it to an exit.
   - `RunEvent::Exit` (the macOS `terminate:` path) cannot be prevented, so
     `run_terminal_teardown_blocking` reaps PTYs and stops the Host on the main
     thread before the process ends. It skips the observability round trips;
     `host_stop`'s `HOST_GRACEFUL_SHUTDOWN_TIMEOUT` (stdin EOF) then kill bound
     it.
2. **The supervisor's restart budget is shared** across supervisors
   (`HostBridgeState.restart_attempts`). A Host that dies before
   `RESTART_STABLE_UPTIME` (30 s) continues the backoff schedule instead of
   resetting it; once the schedule is spent the status goes `fatal`. An
   explicit `host_start` grants a fresh budget.
3. **A successor Host stops an orphaned predecessor** before acquiring the
   root lease (`stopOrphanedPiwinRootOwner`, called by `host serve`). The
   owner is an orphan only if it is alive, its parent is PID 1
   (launchd/init), its argv runs `host serve`, and its `ps` start time matches
   the owner record's `processStartedAt` (PID-reuse guard). The successor
   sends SIGTERM and waits up to 10 s. If the orphan is still alive, the
   successor first asks it for a diagnostic report (SIGUSR2) and stack-samples
   it (ADR 0099). Then it sends SIGKILL with a 3 s wait, and the lease
   reclaims the dead owner. Any other live owner is never signalled; the lease
   fails with `PiwinRootAlreadyOwnedError` and decision 2 bounds the retries.
   `host serve` now drains on SIGTERM like SIGINT. Windows has no
   reparent-to-init signal, so the takeover is a no-op there.

## Consequences

- Dock Quit / Cmd+Q stop the sidecar within ~750 ms (+ kill) instead of
  leaving it to the OS.
- A Host start blocked by a live non-orphan owner produces at most
  `RESTART_BACKOFF_SCHEDULE.len()` respawns and a clear fatal status.
- SIGKILL of an orphan after 10 s can cut a write the orphan was still
  flushing; the orphan has no client left, and the alternative (the user's
  new Desktop has no Host) was judged worse.

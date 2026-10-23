# ADR 0100: The root lease checks owner identity; a Host that cannot start says why and is not respawned

- **Status**: Accepted
- **Date**: 2026-10-23
- **Scope**: `@piwin/host-runtime` (root lease, orphan takeover), `apps/cli` (`host serve`), `apps/desktop/src-tauri` (`host_bridge`), `@piwin/contracts` (`host/status` push), `apps/desktop` (bootstrap)
- **Amends**: ADR 0096 (decisions 2 and 3)

## Context

A user on 0.2.8 (macOS) saw a "设置错误" toast saying `host process died: stdout
closed`. Relaunching the app and rebooting did not help. Their `host.log` showed
the same pattern every 2–5 s:

```
[piwin host serve] root owner pid=885 kind=cli-command: owned
piwin root is already owned by process 885
```

The lease decided ownership from liveness alone (`kill(pid, 0)`). A PID outlives
its process: after a crash or a hard shutdown left `~/.piwin/.host/owner.lock`
behind, the recorded PID can later belong to an unrelated process. A low PID such
as 885 is typically a login item that starts at boot. That process counted as the
owner, so no Host could ever start. ADR 0096's takeover already compared the `ps`
start time with `processStartedAt`. But it only used that check to decide whether
the owner was an orphan, never to decide whether the lock was stale.

Desktop then showed only `stdout closed`. The real reason was on stderr, which
Desktop forwarded only to the log panel. Each relaunch also used up the restart
budget for an error that could not go away on its own.

## Decision

1. **Owner identity, not just liveness** (`piwin-root-owner-process.ts`). The
   owner record gains an optional `processExecPath` (`process.execPath`).
   A live PID is the recorded owner only if its `ps` start time matches
   `processStartedAt` within 10 s and, when the record has an executable, its
   `ps` command contains that executable's basename. Older records have no
   executable, so for them the start time alone decides.
   - `acquirePiwinRootLease` treats a PID that fails this check as gone and
     reclaims the lock through the existing tombstone rename. This also covers
     a foreign-user PID (`EPERM`) that `ps` can show is a different process.
     When `ps` is unavailable (Windows), behavior is unchanged.
   - `stopOrphanedPiwinRootOwner` returns a new outcome, `pid-reused`, and
     never signals such a process.
2. **A short wait for a legitimate owner.** When the takeover returns `owned`,
   `host serve` waits up to 5 s for the owner to let go before acquiring the
   lease (`waitForRootOwnerRelease`). Typical owners are a short CLI command or
   a previous sidecar that is still draining. This wait replaces the
   cross-respawn retries that decision 3 removes for this case.
3. **Deterministic startup failures are terminal and explained.**
   - `host serve` handles `PiwinRootAlreadyOwnedError` and
     `PiwinRootOwnershipUnknownError` the same way. It writes one stderr line
     `[piwin-host:fatal] <user-facing reason>` and exits with code 78
     (EX_CONFIG).
   - Desktop keeps a bounded stderr tail per sidecar (`exit_reason.rs`). On an
     unexpected stdout EOF it waits up to 1 s for stderr to close and for the
     exit status. It then settles one reason: the fatal line if there is one,
     otherwise the exit code or signal plus the last stderr line, otherwise
     `stdout closed`.
   - Pending requests, and requests sent to the dead process later, fail with
     `host process died: <reason>`.
   - Exit code 78 skips the supervisor. Desktop emits `host-status` `fatal`
     with that reason, which reaches the UI as `host/status { ready: false,
     reason }`, and bootstrap shows it once as an error toast. Other deaths
     keep ADR 0096's bounded restarts, and their final `fatal` carries the
     last reason.

## Consequences

- A stale lock whose PID was reused no longer blocks every Host start until
  someone deletes it by hand.
- A truly owned root shows the owning PID and what to do in the toast, and
  stops after a single attempt instead of five.
- The `host/status` push has a new optional field. Older clients ignore it.

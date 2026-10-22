# ADR 0099: Host hang diagnostics

- Status: Accepted
- Date: 2026-10-22

## Context

A packaged Host (`host serve`) ran for ~1.5 days, then stopped answering:
models stalled, `host.log` went silent, and when Desktop relaunched, the
successor's SIGTERM was ignored for 10 s and the orphan was SIGKILL-ed. There
was nothing left to explain it:

- `slow command` lines are written only when a command **finishes**, so a
  handler that never settles leaves no trace.
- Nothing watched the main event loop. A blocked loop (sync work, GC thrash
  near the V8 heap limit) also blocks every main-thread timer and `console`
  write, so the Host cannot report its own hang.
- SIGTERM shutdown waits on `dispatcher.drain()`, so "ignored SIGTERM" can
  mean a blocked loop or a handler that never resolves. The two could not be
  told apart, and SIGKILL then destroyed the evidence.

## Decision

`host serve` starts hang diagnostics (`apps/cli/src/host-hang-watchdog.ts`).
Every timer is unref'd:

1. **Watchdog thread.** The main thread writes a heartbeat (time, V8 heap
   used/limit) into a `SharedArrayBuffer` every second. An `eval` worker (no
   extra file next to the bundle; `env: {}`) polls it. When the heartbeat is
   ≥ 5 s old, the worker appends to `~/.piwin/logs/host.log` **directly**
   (not through `console`, which the blocked main thread relays):
   `main event loop blocked … rss=… mainHeapUsed=… mainHeapLimit=…`. It logs
   again every 60 s while the block lasts, and `recovered after ~Nms` when it
   ends. If the block reaches 20 s on macOS, it runs `/usr/bin/sample <pid> 3`
   into `~/.piwin/diagnostics/host-hang-<pid>-<ts>.sample.txt` (at most 3 per
   process). A worker poll gap larger than 4× its period (system sleep) is
   ignored.
2. **Resource line** every 10 min: `resources uptime= rss= heapUsed=
   heapLimit= external= arrayBuffers= inflight=`, plus `HEAP-NEAR-LIMIT` at
   ≥ 85 % of the heap limit.
3. **Long-running commands.** The dispatcher tracks each **handler** (not the
   deadline race), so a handler whose client already got
   `command timed out` stays visible. It logs `command still running <type>
   lane= age=` at 30 s, 2 min, 10 min and 30 min, then every 30 min. On
   SIGINT/SIGTERM, `host serve` logs what the drain is waiting on before it
   starts draining.
4. **Report before SIGKILL.** The Host writes a Node diagnostic report on
   `SIGUSR2` (`PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL`; SIGUSR1 is the
   inspector's). The report goes to
   `~/.piwin/diagnostics/host-report-<pid>-signal-<ts>.json`, alongside the
   in-flight list and a resource line. Reports are built with `getReport()`
   and every `environmentVariables` block is stripped before writing (mode
   0600). `excludeEnv` alone still embeds worker-thread env, and env holds
   provider keys. When an orphan ignores SIGTERM,
   `stopOrphanedPiwinRootOwner` (given `diagnosticsDir`) now sends SIGUSR2,
   takes a 3 s `sample` of the orphan on macOS (which also gives the report
   time to land), and only then sends SIGKILL (amends ADR 0096 decision 3).
   An older Host without the handler dies on SIGUSR2's default action, which
   counts as `killed`.

`~/.piwin/diagnostics` keeps the newest 20 `host-hang-*` / `host-report-*` /
`orphan-host-*` files; older ones are pruned when the Host starts.

## Consequences

- A hung Host now leaves, in order: long-running command lines, the blocked
  loop line with heap numbers, a native stack sample, and the successor's
  report/sample. Together these separate a blocked loop (GC vs. sync code vs.
  syscall) from a handler that never resolves.
- A fully blocked loop cannot run the SIGUSR2 handler, so that case relies on
  the native samples. JS frames show up mostly as JIT addresses; GC, syscall
  and native-addon frames are symbolized.
- Native sampling is macOS-only. Other platforms get the log lines and the
  report only.
- The standalone `apps/host` server (`host-listen.mjs`) does not start the
  watchdog yet.

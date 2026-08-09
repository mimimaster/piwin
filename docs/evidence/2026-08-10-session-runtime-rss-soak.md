# Session runtime residency native RSS soak evidence

| Field | Value |
|-------|-------|
| Date | 2026-08-10 (Asia/Shanghai) |
| Branch | `feat/session-runtime-residency` |
| Decision | [ADR 0040](../adr/0040-host-session-runtime-residency.md) |
| Plan | [Session runtime memory control](../plans/2026-08-09-session-runtime-memory-control.md) |
| Result | **PASS — native SDK and native RPC** |

## Scope

Both runs used a real `HostRuntime` (`mock: false`) and the configured provider.
Each run rotated across six durable sessions for 30 minutes, resumed one session
and issued one real prompt per minute. The retention policy was intentionally
tight so every cycle exercised cold activation and eviction:

- idle TTL: 45 seconds;
- maximum idle runtimes: 1;
- maximum resident runtimes: 2;
- sample interval: 5 seconds.

RPC ran the bundled native Agent worker and sampled Host plus worker RSS. The
runner copied normalized configuration to an isolated temporary piwin root and
resolved the configured provider secret into a transient, task-specific
environment variable. Secret values were neither logged nor written to the
evidence files.

## Commands

```bash
pnpm bundle:host
pnpm soak:session-runtime -- --mode sdk --duration-minutes 30 \
  --sample-seconds 5 --prompt-interval-seconds 60 --sessions 6 \
  --max-resident 2 --max-idle 1 \
  --output docs/evidence/session-runtime-rss-soak-2026-08-10-sdk-30m

pnpm soak:session-runtime -- --mode rpc --duration-minutes 30 \
  --sample-seconds 5 --prompt-interval-seconds 60 --sessions 6 \
  --max-resident 2 --max-idle 1 \
  --output docs/evidence/session-runtime-rss-soak-2026-08-10-rpc-30m
```

## Results

| Metric | SDK | RPC |
|--------|----:|----:|
| Soak duration | 30.065 min | 30.034 min |
| Real prompt/resume cycles | 30 | 30 |
| Samples | 359 | 359 |
| Sample completeness | complete | complete |
| Aggregate RSS min / max / p95 | 95 / 421 / 224 MiB | 87 / 622 / 382 MiB |
| Full-run aggregate slope | -120.13 MiB/hour | -168.50 MiB/hour |
| Maximum resident / idle / busy | 1 / 1 / 1 | 2 / 1 / 1 |
| Maximum capacity waiters | 0 | 0 |
| Idle-TTL / max-idle evictions | 29 / 6 | 29 / 6 |
| Memory-pressure failures | 0 | 0 |
| Observed worker PIDs | n/a | 31 |
| Worker PIDs alive after Host dispose | 0 | 0 |
| Runner verdict | pass | pass |

The full-run maximum includes startup/provider warm-up. A short linear window
is sensitive to Node/V8 allocator release: for example, one low GC sample can
make a later return to the normal plateau look like a steep positive slope.
As a more robust steady-state check, the peak of each one-minute cycle was also
regressed over cycles 21–30:

| Last-ten-cycle peak trend | SDK | RPC |
|---------------------------|----:|----:|
| First → last aggregate peak | 193 → 197 MiB | 342 → 346 MiB |
| Regression over ten cycles | +5.15 MiB | -6.12 MiB |

This is a bounded plateau, not per-generation accumulation. RPC additionally
showed the worker RSS returning to zero between generations, a new PID on cold
reactivation, and no observed worker PID alive after final Host disposal.

## Raw evidence

- [SDK CSV](session-runtime-rss-soak-2026-08-10-sdk-30m.csv)
- [SDK summary](session-runtime-rss-soak-2026-08-10-sdk-30m.summary.json)
- [RPC CSV](session-runtime-rss-soak-2026-08-10-rpc-30m.csv)
- [RPC summary](session-runtime-rss-soak-2026-08-10-rpc-30m.summary.json)
- [SDK preflight CSV](session-runtime-rss-soak-2026-08-10-sdk-preflight.csv)
- [SDK preflight summary](session-runtime-rss-soak-2026-08-10-sdk-preflight.summary.json)
- [RPC preflight CSV](session-runtime-rss-soak-2026-08-10-rpc-preflight.csv)
- [RPC preflight summary](session-runtime-rss-soak-2026-08-10-rpc-preflight.summary.json)

## Regression verification

Final verification after the soak runs:

- repository-wide `pnpm typecheck`: passed (29 workspace projects);
- package-boundary architecture check: passed;
- `@piwin/contracts`: 202 tests passed;
- `@piwin/agent-host`: 164 tests passed;
- `@piwin/session`: 190 tests passed;
- `@piwin/host-runtime`: 1017 tests passed, including SDK/RPC 50-session
  residency, multi-client cold-history, admission cancellation, transcript
  migration/derived operations, suspension ordering, and shutdown cleanup.

The repository aggregate `pnpm test` still fails in four Desktop
`resolve-document-content.test.ts` cases. Neither that implementation nor its
tests are modified by this branch; the same unrelated failure was already
recorded in the WP6 closure. All packages changed for ADR 0040 are green.

## Verdict and remaining rollout check

The native residency/RSS gate passes in both backend modes. Count/TTL policy,
RSS sampling, cold worker replacement, and final worker termination are proven
by native evidence.

The remaining WP8 item is a manual end-to-end cross-feature matrix for
permissions, MCP, and subagent behavior after cold reactivation. Deterministic
Host tests cover their eviction blockers and lifecycle cleanup, but this report
does not relabel those tests as native provider-driven cross-feature evidence.

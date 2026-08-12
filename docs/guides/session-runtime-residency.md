# Session runtime residency (ADR 0040)

Runtime **cold** is not storage offload. A runtime-cold session still has its
transcript and media on the Host. Moving those files to an external pack is
ADR 0044 — see [`session-cold-storage.md`](./session-cold-storage.md).

## What Host owns

- Cold / activating / resident-idle / resident-busy / suspending state machine
- Idle TTL, max-idle LRU, max-resident, and optional RSS high-water eviction
- Stable product session id + generation-scoped Agent event identity
- Aggregate metrics via `host/runtime-resources`

Clients never run local timers, LRU, or memory thresholds.

## Desktop

Settings → **Session Runtime**:

- Settings staleness (Live / Stale / Rebuilding / Failed)
- Residency truth: Cold / Starting / Ready / Busy / Suspending
- Retention budgets (idle TTL, max idle, optional resident cap, optional memory high water)
- Aggregate Host resource metrics (refreshable)

Cold sessions keep history usable. Ordinary chat shows a subtle **Restoring runtime**
phase only when a cold prompt is waiting for capacity (`waiting-resource`).

## CLI doctor / status

```bash
piwin doctor
piwin status [--mock]
```

Both print a `runtime residency` block with resident/idle/busy counts, budgets,
RSS samples, and eviction counters.

## Soak / evidence

Automated release-gate tests live in
`packages/host-runtime/src/session-runtime-residency.integration.test.ts`
(50-session policy bounds, multi-viewer cold history, cancel-while-waiting via
`session/prompt` + `session/abort`).

Notes on automation scope:

- `sdk` and `rpc` cases both use `mock: true`; they exercise Host residency
  policy, not real RPC worker process counts.
- Native 30-minute switch/prompt soak remains operator evidence: sample Host +
  worker RSS with `host/runtime-resources` counters on each tick and keep
  samples under the configured high water after warm-up and eviction.

Cold diagnostics: after suspension, `session/runtime-status` reports
`residency: "cold"` and `lastEvictionReason` so Desktop Settings can show Cold
and the last eviction cause (never a vague Unknown for a normal cold session).

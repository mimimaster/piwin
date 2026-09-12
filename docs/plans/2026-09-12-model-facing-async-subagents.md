# Model-facing async subagents — completed plan record

| Field | Value |
|-------|-------|
| Status | **Completed** (2026-09-13) |
| Branch | `feat/async-subagents` |
| Base | `c7b8f879` |
| Worktree | `/Users/yorickjue/Developer/piwin-async-subagents` |

## Goal

Structured in-turn subagent concurrency: start one task and return, wait or
cancel by `runId`, with Host-owned missed-wait settlement and Desktop surfaces
that render Host-normalized presentation only.

## Shipped Host tools

| Tool | Role |
|------|------|
| `piwin_subagent_run` | Unchanged synchronous spawn+merge convenience path |
| `piwin_subagent_start` | One task; returns after durable manifest + queued invocation acceptance |
| `piwin_subagent_wait` | Control tool; 1–8 `runIds` (order-preserving dedupe) |
| `piwin_subagent_cancel` | Control tool; 1–8 `runIds` (order-preserving dedupe) |

`waitPolicy` stays `'await-all'`. Scheme admission is held for the full child
lifetime. Missed wait → at most one Host-authored settlement continuation;
parent phase `waiting-subagents` with `joining-descendants` then
`synthesizing-reports`. Parent fail/cancel/pause/replace cancels descendants
and skips continuation.

## Shipped Desktop surfaces

| Slice | Surface |
|-------|---------|
| F1 | Right panel **Tasks** tab — orchestration overview (no auto-open) |
| F2 | Transcript invocation cards + wait/cancel lifecycle rows via `subagentControl` |
| F3 | Tasks overview for subagent batches |
| F4 | `waiting-subagents` settlement phase copy |
| F5 | Composer **activity pill** (async subagents + live `process_start` jobs) + Terminal job-log switcher |

The activity pill is a compact reachability rail, not a return of the ADR 0046
composer-adjacent current-work dock.

## Task ledger (summary)

| Task | Scope |
|------|-------|
| B0 | Contracts + agent-host presentation split |
| B1 | Shared subagent tool input parsing |
| B2 | `start` / `wait` / `cancel` host-runtime tools |
| B3 | Abort latch + active-run edge cases |
| B4 | Missed-wait settlement continuation |
| B5 | Parent fail/cancel/pause/replace descendant cleanup |
| F1–F5 | Desktop orchestration view, inline lifecycle, Tasks tab, waiting copy, activity pill |

## Commits on branch (`c7b8f879..cb9b6b4a`)

```
92e780be refactor(agent-host): split tool presentation classification
09dd5028 feat(contracts): define async subagent presentation
5e885e9e refactor(host-runtime): share subagent tool input parsing
06ea374c feat(host-runtime): add async subagent start wait and cancel
3eec7767 fix(host-runtime): key start abort on accepted latch
d0497292 feat(host-runtime): settle uncollected subagent reports
a827a373 fix(host-runtime): treat continuation abort as host stop
42f914e4 feat(agent-host): present async subagent start wait and cancel
d3e76294 feat(desktop): derive async subagent orchestration view
2c950576 feat(desktop): present async subagent lifecycle inline
1871231d feat(desktop): add tasks overview for subagent batches
10010d21 feat(desktop): present waiting-subagents settlement phase
3dedd6f9 feat(desktop): attach composer activity pill for subagents and jobs
cb9b6b4a fix(host): keep synthesizing-reports through settlement continuation
```

## Related docs

- ADR 0030 — async delegation implementation note
- ADR 0046 — async presentation (start vs wait/cancel, Tasks tab, activity pill)
- `docs/evidence/2026-09-13-async-subagent-review.md` — unit-test review note

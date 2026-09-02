# ADR 0067: Session context occupancy telemetry

- Status: Accepted
- Date: 2026-08-31
- Related: ADR 0022 (billing ledger stays bill-only), ADR 0027 (HostPush)

## Context

The composer ring mixed last-request billing, occupancy, display eligibility,
and a fake cache TTL in one `ContextUsageSnapshot`. Streaming samples were
missing or billed; compact/branch/resume revived stale numbers.

## Decision

1. Occupancy is a versioned `SessionContextSnapshot` in the session
   `transcript.sqlite3` (`session_context_state`). Host is the only authority.
   Clients consume `session/context-updated` and `session/context-get`.
2. Backend facts are `context/measurement` (window fill) and `usage/finalized`
   (one model request). Samples never bill, never fire `turn_end`, never
   forge `session/ended`.
3. `usage/finalized` is the billing ingress; `measurementId` is idempotent.
   Compatible `usage/update` is a projection of a successful finalized insert
   only.
4. Host hello/status advertises `capabilities.contextTelemetryVersion: 1`.
   Clients without that flag hide the ring and do not invent occupancy from
   the ledger.
5. The ring hides until the current foreground Run has real response evidence
   (non-empty text, thinking, or a model-initiated tool call), or a successful
   non-no-op compaction has produced a durable summary. Compaction is evidence
   that Pi accepted a non-empty context even when that turn has no displayable
   assistant text (for example, a media/tool-only transcript).
6. **Host current occupancy promote** is a same-boundary idle restore, not a
   display fallback. Promote only when all of: `phase === 'idle'`; occupancy
   unknown with reason `waiting-for-response` or `run-ended-without-response`;
   known `lastConfirmed`; current-run or history response evidence; strict
   `contextBoundaryCompatible` (active leaf included). Copy `lastConfirmed`
   occupancy as current occupancy; do not bump `contextVersion`; do not rewrite
   phase. Never promote `runtime-generation-mismatch`, abort/error,
   compact-unmeasured, store-unavailable, branch/schema invalidated, empty, or
   an incompatible boundary (including a moved leaf). `session/resume` and
   `session/context-get` return this Host snapshot.
7. **Desktop presentation-only stale fallback** may show `lastConfirmed`
   numbers without changing Host authority. It requires all of:
   `phase === 'invalidated'`, or a legacy `phase === 'idle'` row that has not
   yet been cold-repaired; unknown reason exactly
   `runtime-generation-mismatch` or the interrupted-response legacy
   `waiting-for-response`; `historyHasDisplayableResponse`; no live `runId` or
   current-run response; and a non-leaf-compatible boundary. The model axis
   may differ because a model switch invalidates the number for budgeting but
   does not make the previous measurement useless to the user; compaction,
   capability, and seed axes must still match (moved leaf is allowed). Label:
   「上次确认，当前上下文待测量」 / "Last confirmed; current context pending
   measurement". Snapshot stays unknown/invalidated. Compact and model-switch
   budget (`readContextOccupiedTokens`) read only current known occupancy,
   never `lastConfirmed`.
8. Publisher persist equality includes `lastConfirmed`, context boundary,
   covered/evidence ids, and occupancy/`lastConfirmed` `sampledAt`. It may
   ignore only `revision`/`updatedAt`. A lastConfirmed-only change must be
   written.
9. Derived sessions (fork/duplicate) stay `unknown(derived-session)` until the
   target active path is measured. History evidence may copy; occupancy,
   `lastConfirmed`, live owner, revision, and `contextVersion` must not.
   When copied history evidence exists, Desktop may show a neutral pending
   measurement ring as presentation-only feedback; it must remain numeric
   hidden and must not turn the unknown value into current occupancy.
10. Clients restore the same session from the warm cache on A→B→A.
    `selectSession` does not clear `disconnected`; only reconnect restores
    online. Offline warm display stays labeled offline.
11. Cold hydrate repairs old-patch idle+known cross-leaf pollution and the
    equivalent interrupted-response idle+unknown rows (`waiting-for-response`
    or `runtime-generation-mismatch`): demote to `invalidated` +
    `unknown(runtime-generation-mismatch)`, keep `lastConfirmed`, clear
    covered ids, do not bump `contextVersion`, persist via CAS, idempotent on
    the next hydrate. Repair runs before settle; mismatch is not promotable,
    so repair cannot be undone into known. A real `waiting-response` phase is
    still the first-response gate and remains hidden.

## Consequences

- Compact, branch, truncate, and runtime replace bump `contextVersion`; stale
  samples CAS-fail.
- Historical host-estimate ledger rows are left in place.
- SDK and RPC share the same sampler/estimator inside `agent-host`.
- Stale `lastConfirmed` is Desktop presentation only; it is not Host current
  occupancy and must not enter budget or compact decisions.

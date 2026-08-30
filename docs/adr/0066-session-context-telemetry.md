# ADR 0066: Session context occupancy telemetry

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
   (non-empty text, thinking, or a model-initiated tool call).

## Consequences

- Compact, branch, truncate, and runtime replace bump `contextVersion`; stale
  samples CAS-fail.
- Historical host-estimate ledger rows are left in place.
- SDK and RPC share the same sampler/estimator inside `agent-host`.

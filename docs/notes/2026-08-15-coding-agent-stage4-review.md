# Stage 4 Coding-Agent Review Note

Date: 2026-08-15

## Outcome

The long task exercised a Host-first vertical slice for durable queued turns
and Replace Run. The implementation stayed inside the package dependency
rules, kept Pi imports behind `@piwin/agent-host`, and added contracts before
store/runtime/UI wiring.

## Evidence

- `pnpm typecheck` — PASS.
- `pnpm test` — PASS after fixes, including Desktop 207 files / 1,374 tests.
- `pnpm test:architecture` — PASS.
- `pnpm e2e:smoke` — PASS.
- `pnpm e2e:host-jsonl` — PASS, 49 assertions.
- Desktop production build and Rust check/tests — PASS; Rust 17 tests.
- `git diff --check` — PASS.
- `pnpm format:check` — baseline failure: broad drift and two invalid HTML prototypes.
- `pnpm e2e:desktop` — timed out after selector/snapshot failures; no native claim.

## Bugs found and fixed

The review found nine concrete defects, including queue reorder sequence
collisions, remote media ref loss, aggregate-bound bypass on edit, terminal
egress ordering, stale queue revision after optimistic submit, slash-mode
freeze loss, CLI positional parsing, key-order idempotency, and an unhandled
background drain rejection. Each fixed item is detailed in the evidence bug
register with a regression test or focused proof.

## Residual decision

Score: 81/100 — conditionally usable for continued development with explicit
review gates. Do not claim unrestricted daily complex-development readiness
until the dirty-baseline Desktop E2E suite is reconciled and Native Tauri
real-provider, two-client, reconnect/restart observations are recorded.

The correlation ledger remains content-free: only ids, revisions, statuses,
sequences, terminal codes and timestamps belong in follow-up evidence.

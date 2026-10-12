# Subagent active admission — 2026-10-11

The product owner requires a simultaneous-task ceiling. Terminal children must
not consume a cumulative quota within the parent turn.

The previous gate rejected once historical `startedCount` reached
`maxTasksPerRun`. Admission now waits only when `activeCount` reaches
`min(maxConcurrency, maxTasksPerRun)`. Existing completion/failure/cancellation
and failed preparation/acceptance release paths make the slot reusable.
Historical admissions remain visible for diagnostics. Single-batch size checks
remain separate, and their error now says “this batch”. Settings copy,
contract comments, architecture and ADR 0030 record the same semantics.

## Verification

- Before the fix, six regression cases reproduced the cumulative-quota error.
- Six related Host suites: 61 tests passed, including 24 sequential admissions,
  eight active slots with ninth/tenth waiters, repeated release, aborted wait,
  terminal completed/failed/cancelled children alongside one running child,
  failed durable acceptance, continuation, and the delivery review loop.
- Contracts: 808 tests passed across 104 files.
- Desktop subagent settings: 22 tests passed across three files.
- Package boundaries passed; changed production files remain below 1000 lines.
- Host Runtime and Contracts typechecks passed within the root typecheck.
- Full Host Runtime: 3917 tests passed, three unrelated failures: two CHT-803
  chat-prompt budget assertions (2572 > 2500) and the catalog-action admission
  assertion for `flashcards:study-read`.
- Root typecheck stopped on another concurrent UI change:
  `apps/desktop/src/subagent-group-card.tsx:21`, unused `SubagentSpinner` import.
- Diff whitespace checks passed. Formatter differences reported for five
  touched files were all already present at HEAD; added lines need no changes.

This verifies source behavior through deterministic Host tests. The running
application was not rebuilt or restarted; it must load the updated Host before
this fix applies to an existing live instance. No real-provider smoke was run.

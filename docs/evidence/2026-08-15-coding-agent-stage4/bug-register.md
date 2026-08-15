# Bug Register

## Baseline issues

### BASE-001 — Repository-wide format gate is not actionable

- Severity: P2
- Category: test/tooling baseline
- Layer: repository gate
- Status: pre-existing, not in Stage 4 scope
- Evidence: `pnpm format:check` exits 2; two HTML prototypes are unparsable and many files are unformatted.
- Impact: the advertised format gate cannot distinguish a new formatting regression from baseline noise.
- Workaround: run Prettier checks only on Stage 4-owned files and preserve the full failure in evidence.

### BASE-002 — SteerQueue test asserts superseded queue copy

- Severity: P2
- Category: test/product drift
- Layer: Desktop local waiting queue
- Status: pre-existing; expected to be replaced by the Stage 4 Host projection
- Reproduction: `pnpm --filter @piwin/desktop exec vitest run src/steer-queue.test.tsx`
- Expected by test: `Sent in order after this response`
- Actual component copy: `Sent in order after this run · ⌘↵ to adjust after the current step`
- Frequency: 2/2 observed runs
- Impact: the full workspace suite is red before Stage 4, and the test encodes the transitional local queue surface that Stage 4 will remove.
- Required handling: do not merely update the string assertion; replace the local-authority behavior with Host-owned queued-turn tests, then retire or rewrite this suite as part of DF-05/DF-08.

## Stage 4 findings

### BUG-001 — Reorder collided with retained terminal queue rows

- Severity / category / layer: P2 / Product-Host / `@piwin/session`
- Status: fixed with regression test
- Reproduction: create one queued turn, transition it to `started`, create two pending turns, then reorder the pending ids.
- Expected: pending order changes atomically.
- Actual: assigning pending sequences from `1` collided with the retained terminal row under `UNIQUE(session_id, sequence)`.
- Fix/evidence: pending rows are temporarily negated and reassigned after the session maximum; `queued-reorder-terminal-row` now passes.

### BUG-002 — Remote queued media paths were not round-trippable

- Severity / category / layer: P2 / Transport / HostServer remote projection
- Status: fixed with regression test
- Reproduction: `media/save` a remote image, submit a queued turn with `remote-asset:<id>`, then list/edit or receive a queued-turn push.
- Expected: the client sees the same opaque `remote-asset:<id>` ref and can edit/replay it.
- Actual: generic path sanitization returned `[host-path]`; the next edit could not resolve the attachment.
- Fix/evidence: queue responses and pushes map known Host paths back to opaque asset refs; host path leakage remains blocked; `remote queued-turn projection` test passes.

### BUG-003 — Editing a pending turn bypassed aggregate queue bounds

- Severity / category / layer: P2 / Product-Host / `@piwin/session`
- Status: fixed with regression test
- Reproduction: fill a session close to the 512 KiB pending text budget, then edit a small pending item to a larger legal per-turn payload.
- Expected: edit is rejected with `queued-turn-queue-full` and the old input remains.
- Actual: only submit checked aggregate bytes, so edit could exceed the durable bound.
- Fix/evidence: transactional edit checks aggregate pending bytes and per-turn UTF-8 bounds; `queued-edit-bounds` now passes.

### BUG-004 — Started queued state could trail the new Run events

- Severity / category / layer: P1 / Transport / HostEgressHub ordering
- Status: fixed with regression test
- Reproduction: enqueue a Replace turn, admit the new Run, then ingest `run/updated` and `session/queued-turn-updated(started)` while the egress batch is pending.
- Expected: old `run/terminal` → queued state → new Run events.
- Actual: using `startedRunId` as `runBarrierId` flushed new Run events before the queued state.
- Fix/evidence: started queue pushes no longer barrier on the new Run; `HostEgressHub` ordering test passes.

### BUG-005 — Queue reorder could use a stale client revision after submit

- Severity / category / layer: P2 / Product-Desktop / Desktop queue projection
- Status: fixed with regression test
- Reproduction: submit a next-turn while a Run is active, then immediately use “send now” before another session hydration.
- Expected: reorder uses the current Host queue revision.
- Actual: the optimistic queue record did not carry queue revision, so the client sent the initial `0` and received a conflict.
- Fix/evidence: Desktop refreshes `session/queued-turn-list` after successful queue admission; focused composer test asserts hydration.

### BUG-006 — Slash-mode transformation was lost when Send became queued

- Severity / category / layer: P1 / Product-Desktop / Composer
- Status: fixed with regression test
- Reproduction: while streaming, send `/plan focus on the failing test`.
- Expected: frozen queue input is `text=focus on the failing test`, `agentMode=plan`.
- Actual: the queue branch previously captured raw slash text before the ordinary prompt transformation.
- Fix/evidence: transformation now precedes both paths; `freezes slash-mode prompt preparation` passes.

### BUG-007 — CLI reorder included the session id as a queued id

- Severity / category / layer: P2 / Agent behavior / CLI parser
- Status: fixed
- Reproduction: `piwin session queue reorder <session> <queued-a> <queued-b>`.
- Actual: positional slicing included `<session>`; Host rejected the list.
- Fix/evidence: parser now uses `argv.slice(4)` and CLI helper tests pass.

### BUG-008 — Idempotency falsely conflicted on object key order

- Severity / category / layer: P2 / Product-Host / durable store
- Status: fixed with regression test
- Reproduction: retry the same queued payload with PromptInput object keys in a different insertion order.
- Actual: JSON comparison treated equivalent objects as different.
- Fix/evidence: structural comparison uses stable serialization; `queued-idempotency` passes.

### BUG-009 — Synthetic session terminal could leak an unhandled drain rejection

- Severity / category / layer: P2 / Product-Host / queued drain cleanup
- Status: fixed
- Reproduction: notify a terminal callback after a short-lived/memory-pressure fixture has already released its session store.
- Actual: background drain rejection was unhandled.
- Fix/evidence: `drainSafely` converts it to an operator-visible `host/log` warning; HostRuntime tests remain green.

### BASE-003 — Desktop E2E suite has dirty-baseline selector/snapshot drift

- Severity / category / layer: P2 / Spec/test baseline / Desktop E2E
- Status: observed, not attributed to Stage 4
- Evidence: `pnpm e2e:desktop` timed out at 300s after 22/61 tests; focused reruns report missing `sessions-empty` and `primitive-gallery` test ids plus an `ink-empty-shell-1280` screenshot diff.
- Impact: browser E2E cannot currently serve as a clean Stage 4 acceptance gate. Unit tests, Desktop build, and Rust tests remain green.
- Required handling: baseline owner should reconcile the existing shell/theme selectors and snapshots before using this suite for Native/desktop claims.

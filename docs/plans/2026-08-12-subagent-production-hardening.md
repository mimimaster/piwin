# Subagent Production Hardening

Date: 2026-08-12

## Goal

Forward-port the production-safe parts of `codex/subagent-production` onto the
current Main architecture without replacing Main's newer invocation,
continuation, parent-Run anchoring, or provider-secret bootstrap behavior.

## Authority invariants

- `RunRegistry` remains the live Run lifecycle and terminal-state authority.
- `SubagentOrchestrator` remains the only batch scheduling authority.
- Durable manifests are recovery evidence and client projections, not a second
  scheduler.
- One canonical piwin data root has at most one mutating Host owner.
- Cancellation before the integration commit point cannot mutate the parent
  repository.
- Cancellation after the integration commit point joins the non-cancellable
  integration and records the physical result.
- Startup recovery never replays model execution or file-writing work.
- Parent Git index contents remain unchanged by subagent integration.
- Failed, conflicted, cancelled-before-commit, and ambiguous worktrees are
  retained.
- Provider secret values never enter manifests, structured failures, or remote
  projections.

## Scope

1. Replace the promise-tail integration lock with a cancellable FIFO queue.
2. Pass each child Run's abort signal through integration admission.
3. Define and test the cancellation boundary before parent mutation.
4. Enforce single-Host ownership of the canonical piwin root and release it
   only after Host disposal joins writers.
5. Harden subagent manifests with safe identifiers, strict versioned parsing,
   exclusive creation, atomic replacement, and owner-only permissions.
6. Persist workspace leases and runtime snapshots that the run-store schema
   already claims to retain.
7. Add structured, bounded, redacted durable failure information while keeping
   the current human-readable error field for compatibility.
8. Add a recoverable integration journal before enabling stronger startup
   reconciliation.
9. Await ownership-fenced recovery before opening new subagent admission.
10. Harden generated worktree identity and distinguish unrestricted output
    policy from an explicit empty deny-all allowlist.

## Explicit non-goals

- Do not merge or cherry-pick `codex/subagent-production` wholesale.
- Do not add automatic semantic retry.
- Do not conflate Retry, Continue, and Repair.
- Do not persist ephemeral provider credentials.
- Do not automatically roll back or reverse-apply an ambiguous parent change.
- Do not replace current Main IPC command or invocation identities.

## Implementation order

### 1. Cancellation-safe integration admission

- Add an optional integration control containing an `AbortSignal`.
- Remove cancelled entries from a per-repository FIFO queue.
- Re-check cancellation after queue acquisition and immediately before the
  integration commit point.
- Retain the worktree and return a cancellation-specific result without calling
  the Git mutator when cancellation wins.

### 2. Host root ownership

- Canonicalize the selected piwin root.
- Acquire an atomic directory lock before constructing root-backed services.
- Record a versioned owner token and heartbeat for diagnostics.
- Reclaim only a strictly valid owner whose process is provably dead.
- Fail closed for malformed, unknown, permission-denied, or live ownership.
- Release only the lock whose token still belongs to the current Host.

### 3. Manifest durability

- Validate Run IDs before deriving filenames.
- Add a manifest version while accepting the current complete legacy shape.
- Treat only `ENOENT` as missing; surface corruption and unsupported versions.
- Publish JSON through same-directory temporary files and atomic rename.
- Create new Run manifests exclusively and write files with mode `0600`.
- Preserve invocation, continuation, model, and parent-anchor fields.

### 4. Integration transaction journal

- Prepare a durable patch and before/after parent fingerprints without
  modifying the parent.
- Persist `prepared`, then persist `applying` as the write-ahead commit point.
- Apply without an abort signal, verify the postimage, persist `applied`, then
  clean the generated worktree and persist `cleanup-complete`.
- On restart, classify `applying` as before/after/diverged and never guess when
  the parent state is ambiguous.

### 5. Recovery and projections

- Acquire root ownership before reading or migrating manifests.
- Reconcile integration checkpoints before interrupted child execution.
- Terminalize abandoned execution without replay.
- Repair child-session and invocation projections idempotently.
- Open Host readiness and new batch admission only after recovery completes.

### 6. Failure and identity hardening

- Persist stable failure kind/code/phase/retryability with bounded redacted
  messages.
- Separate transport push failures from durable execution truth.
- Use collision-resistant generated worktree identities.
- Reject stale generated branches unless an explicitly validated continuation
  owns them.

## Verification gates

- A task cancelled while queued for integration never calls the parent Git
  mutator.
- Same-repository integrations remain serialized; different repositories may
  proceed concurrently.
- A second Host cannot own or recover the same root while the first is live.
- A dead, strictly valid owner can be reclaimed without deleting a replacement
  owner's lock.
- Corrupt or future-version manifests fail visibly instead of appearing absent.
- Concurrent manifest mutations retain all sibling fields.
- Crash tests cover prepared, applying-before-mutation,
  applying-after-mutation, applied-before-cleanup, and ambiguous parent state.
- Parent staged index remains byte/logically unchanged in every integration
  scenario.
- Existing invocation, continuation, and provider-secret bootstrap tests pass.
- Package typechecks, architecture checks, focused suites, and the reusable
  real subagent integration smoke pass before branch cleanup.

## Cleanup gate

Delete the local `codex/subagent-production` branch and any worktree attached
to it only after all verification gates pass. Do not delete a remote branch or
push any changes unless separately requested.

## Result (2026-08-12)

Implemented on current Main as additive hardening; the old branch was not
merged wholesale:

- Cancellation-safe integration admission: explicit per-repository FIFO queues
  that remove cancelled entries, task Run signals passed through
  `SubagentIntegrationControl`, a conservative commit point before parent
  mutation, and post-commit cancellation joining instead of discarding.
- Single-Host root ownership: `piwin-root-lease` with atomic directory lock,
  strict versioned owner records, PID liveness checks, tombstone reclamation of
  provably dead owners, fail-closed unknown/malformed ownership, and
  token-verified release; enforced by `HostRuntime` production defaults
  (`rootOwnership.enabled`) with a unified host instance ID used by the
  standalone Host server.
- Manifest hardening in `SubagentRunStore`: safe run-id validation, exclusive
  creation, atomic temp-file publication with owner-only permissions, and
  corrupt manifests surfacing as typed errors instead of "missing".
- Structured redacted failures: `SubagentFailure` contract, redaction module
  (bearer/API keys, query secrets, product-owned absolute paths, bounded
  length), used by orchestrator failures and interrupted recovery, with the
  legacy `error` field preserved.
- Ownership-fenced recovery: startup reconciliation is now a joined promise
  awaited by new subagent admission (`whenSubagentStartupRecoveryReady`) and by
  disposal before lease release.
- Output allowlist semantics: `allowedOutputPaths` `undefined` means
  unrestricted; an explicit empty list is deny-all in both the coordinator and
  the Git integration layer.
- Leases and runtime snapshots are now persisted by the orchestrator through
  the run store port.

Verification: host-runtime 128 files / 1207 tests, contracts 26 files / 220
tests, git 8 files / 23 tests, session 26 files / 220 tests, package boundary
checks OK, CLI/host-app/host-server typechecks pass modulo the pre-existing
staged `transcript-store.ts` `exactOptionalPropertyTypes` error. The local
`codex/subagent-production` branch was deleted after verification (no worktree
attached, no remote branch).

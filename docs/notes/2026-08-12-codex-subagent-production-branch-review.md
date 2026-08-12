# `codex/subagent-production` Branch Review

| Field | Value |
|---|---|
| Date | 2026-08-12 |
| Target branch | `codex/subagent-production` (`f1b56bf`) |
| Merge base | `e2f5fd8` |
| Committed Main | `90032ad` |
| Scope | Functional overlap, implementation quality, completeness, necessity, and merge recommendation |

## 1. Executive decision

**Do not merge or cherry-pick the branch wholesale.**

The branch contains valuable production-hardening work, but it is a single
41-file WIP snapshot based 13 Main commits behind the current tip. A direct
merge has 10 textual conflicts and would regress newer Main contracts for
inline subagent invocation projection, child continuation, provider secret
bootstrap, and durable client-facing state.

The correct disposition is:

1. Keep Main's current Git/worktree integration and real-worker E2E.
2. Forward-port the branch's strict manifest persistence primitives.
3. Fix cancellation, integration crash consistency, and single-Host ownership
   before enabling startup recovery.
4. Add structured failures to Main without replacing its newer contracts.
5. Redesign semantic retry alongside Main's continuation semantics.
6. Delete or archive the branch after the extracted changes land as small,
   reviewable commits.

The branch is therefore **valuable as an implementation source**, but **not
valuable as a merge unit**.

## 2. Comparison facts

- Branch divergence from committed Main: Main has 13 unique commits; the
  branch has 1 unique commit.
- Branch change size: 41 files, 3,287 insertions, 440 deletions.
- Files also modified by Main after the merge base: 26 of 41.
- Direct merge conflicts: 10 files.
- The only branch commit is titled
  `wip: save uncommitted subagent-production worktree changes before cleanup`.
- The current Main working tree is heavily modified. Some subagent files in
  that working tree are newer than committed Main and already contain
  invocation, continuation, and secret-bootstrap work not present on the
  branch. This review does not overwrite or revert those changes.

## 3. What the branch implements

### 3.1 Durable subagent run recovery

The strongest branch-only slice is the expanded `SubagentRunStore`:

- safe run-id validation;
- strict JSON read errors instead of treating corruption as a missing run;
- versioned manifests;
- exclusive manifest creation;
- temporary-file replacement;
- per-run mutation serialization;
- persisted task snapshots, workspace leases, running states, terminal
  results, retry lineage, and attempt numbers;
- startup enumeration and reconciliation of abandoned runs;
- retained worktree evidence after Host interruption;
- admission gating until recovery has completed.

This is necessary production hardening. Without it, a Host crash can leave a
batch falsely running, lose sibling task state, or make recovery depend on
parsing incomplete files.

### 3.2 Structured failure projection

The branch adds stable failure fields:

- failure kind;
- stable code;
- Host phase;
- retryability advice;
- task and batch identities;
- attempt and retry lineage;
- retained worktree path.

Keeping human-readable `error` while adding machine-readable `failure` is a
sound compatibility strategy. It lets the main model and future clients
distinguish provider failures, worker crashes, integration conflicts,
permission failures, cancellation, and Host restart.

### 3.3 Explicit semantic retry

The branch models retry as a fresh batch/task/child identity with `retryOf`
and a Host-derived attempt number. This matches ADR 0030's rule that the Host
must not silently replay a model stream or file-writing task.

The concept is useful, but the implementation is not ready to port unchanged;
see section 6.

### 3.4 Git/worktree correctness

The branch contains high-quality worktree integration repairs:

- complete child snapshots through an alternate Git index;
- committed, staged, unstaged, untracked, deleted, renamed, and binary changes;
- NUL-delimited pathname handling;
- validation of both sides of a rename;
- three-way calculation against the captured base;
- preservation of the user's parent index;
- applied changes left unstaged in the parent;
- retained conflict worktrees;
- product-owned worktree storage;
- generated branch cleanup;
- explicit non-success status at the model-facing tool boundary.

These changes are valuable, but most are already present in committed Main or
its current working tree. Main's version should remain authoritative.

### 3.5 Worker and orchestration fixes

The branch also improves:

- child worktree `cwd` consistency between Pi built-ins and Host tools;
- provider environment forwarding for isolated workers;
- child transcript recording;
- Plan ownership and verification summary propagation;
- model/scheme resolution;
- production real-worker E2E coverage.

Main has continued evolving these areas, especially provider-secret bootstrap,
parent invocation projection, and child continuation.

## 4. Overlap and supersession assessment

| Area | Branch value | Main status | Action |
|---|---|---|---|
| Alternate-index Git integration | High | Already landed | Keep Main |
| Parent index preservation | High | Already landed | Keep Main |
| Worktree/branch cleanup | High | Already landed/evolved | Keep Main |
| Real worker worktree E2E | High | Present in evolved form | Keep and extend Main |
| Strict atomic-ish run store | High | Not complete on Main | Forward-port |
| Startup reconciliation gate | High | Not complete on committed Main | Redesign after Host fencing |
| Structured failures | High | Not complete on Main | Additively forward-port |
| Retry lineage and cap | Medium/high | Not present; conflicts with continuation design | Redesign first |
| Inline invocation projection | Branch lacks it | Newer Main capability | Preserve Main |
| Child continuation | Branch lacks it | Newer Main capability | Preserve Main |
| Secret bootstrap/auth descriptors | Branch uses older envelope | Newer Main capability | Preserve Main |

## 5. Implementation quality

### Strengths

1. **Architecture alignment:** Host Runtime remains the scheduling/recovery
   owner, Git remains a primitive service, and the worker boundary stays in
   `agent-host`.
2. **Correct no-replay policy:** recovery terminalizes abandoned work rather
   than replaying provider streams or file-writing tasks.
3. **Three-axis state model:** execution, summary merge, and integration remain
   independent.
4. **Failure retention:** conflicted or uncertain worktrees are retained.
5. **Test depth:** the branch includes focused unit, integration, restart,
   concurrency, Git-path, worker, and credentialed real-provider coverage.
6. **Verification:** on the exact isolated branch worktree, root typecheck,
   architecture checks, and the contracts/session/git/agent-host/host-runtime
   test suites all passed.

### Scores

| Dimension | Score | Notes |
|---|---:|---|
| Architecture/design | 7/10 | Good separation, but cancellation and recovery ownership invariants are incomplete |
| Git/worktree correctness | 6.5/10 | Strong snapshot/apply mechanics, but identity and cancellation edges remain |
| Persistence/recovery | 5/10 | Useful primitives; unfenced recovery and ambiguous apply checkpoints block production |
| Tests | 7.5/10 | Broad focused coverage, but key cancellation/crash/multi-Host cases are absent |
| Product completeness | 5/10 | Recovery UX, retry semantics, portability, and multi-client projection remain |
| Direct merge readiness | 2/10 | WIP commit, stale contracts, 10 conflicts, high overlap, production blockers |
| Overall code quality | 5/10 | Strong intent and useful components, but not production-ready |
| Selective extraction value | 7.5/10 | Several designs and primitives remain worth forward-porting |

## 6. Findings and remaining gaps

### P1 - A direct merge would regress newer Main architecture

The branch predates Main's current:

- `invocationId`, parent Run, and parent tool-call anchors;
- durable inline invocation projections;
- child continuation fields and workspace reuse;
- preflight provider credential checks;
- ephemeral worker secret bootstrap;
- durable `onTaskResult` projection independent of push delivery.

Replacing current contract/runtime files with branch versions would remove
these capabilities. This is the primary reason to reject a wholesale merge.

### P1 - Cancellation can still modify the parent repository

Integration is serialized, but the integration queue does not receive an
`AbortSignal`. A child may finish execution, wait behind another repository
integration, be marked cancelled, and later acquire the integration slot and
apply its patch to the parent.

The orchestrator checks admission again only after integration returns. By
then, the parent working tree may already have changed. This means:

- cancelled does not reliably mean no further file mutation;
- retrying a cancelled task can duplicate already-applied changes;
- batch status and task integration state can contradict each other;
- cancellation is not currently a dependable safety boundary.

This issue is also present on Main. Before forward-porting recovery or retry,
integration admission must be cancellable while queued, and cancellation must
join or fence any integration already crossing the parent-mutation boundary.

### P1 - Parent apply and durable state are not crash-consistent

The operational sequence is approximately:

1. apply the child patch to the parent working tree;
2. record the durable `applied` task result;
3. remove the worktree and generated branch.

The branch improves Main by checkpointing before cleanup, but a crash after
step 1 and before step 2 still leaves an ambiguous state: parent files are
changed while the manifest says the task was running or interrupted. Recovery
can then retain a worktree and suggest retry or manual integration even though
some or all changes are already present.

Main is currently worse in this area because cleanup may happen before the
orchestrator records the final result. The production design needs an explicit
integration transaction/journal state such as `applying`, a transaction ID or
patch fingerprint, and recovery logic that reconciles the parent state before
declaring failure, retrying, or cleaning evidence.

### P1 - Startup recovery is not fenced to the owning Host

Every Host using the same piwin root reads the same `subagent-runs` directory.
The branch treats all `running` manifests as abandoned during startup, but the
manifest has no Host owner identity, process start identity, heartbeat, lease
expiry, or cross-process lock.

A second Desktop, CLI Host, or standalone Host can therefore mark the first
Host's live runs failed while their workers continue executing. Process-local
mutation queues do not prevent cross-process overwrites or cleanup races.

The architecture's one-Host-per-data-root rule must be enforced before this
recovery path is enabled. Removing recovery, as Main currently does, avoids
the destructive race but does not provide production restart recovery.

### P1 - Retry admission ignores the branch's own `retryable` policy

`resolveAttempt` accepts a source when it is failed, cancelled, conflicted, or
has any structured failure. It does not require
`sourceResult.failure.retryable === true` and does not reject unchanged
permission, validation, cancellation, or integration-conflict retries.

That contradicts the branch plan, which says permission, validation, and
integration-conflict failures must not be repeated unchanged. The Host must
enforce retry eligibility, not merely advise the model through a boolean.

### P1 - Persisted failure messages need mandatory redaction

The branch creates structured failures from raw exception messages and stores
the message in durable manifests and tool results. Provider and process errors
can contain URLs, headers, command arguments, paths, or secret-bearing text.

Before forward-porting structured failures, add a single Host-boundary
redaction function and persist only a safe display message plus stable code.
Raw internal diagnostics, if retained at all, need a separate protected and
redacted logging path.

### P1 - Manifest parsing is strict for JSON syntax but shallow for schema

The branch verifies a few top-level fields but then casts the rest. It does not
fully validate:

- supported manifest versions;
- the status enum;
- task identifiers and task shape;
- result status axes;
- lease mode and path shape;
- attempt bounds;
- invocation/continuation fields introduced on Main.

Recovery later trusts leases and integration state when deciding retention or
cleanup. The forward-port needs a complete versioned parser with fixtures for
legacy Main manifests, branch manifests, corrupt manifests, and future-version
rejection.

### P2 - Retry and continuation are not the same operation

Main now supports continuation of a terminal child with bounded prior
transcript and a validated existing workspace. The branch adds semantic retry
as a fresh child identity.

The product must define separately:

- **Continue:** same child product identity, new Run, bounded previous context.
- **Retry:** new run/task/child identity, explicit failed source lineage.
- **Repair task:** a new task prompted by a successful reviewer rejection or
  integration conflict.

Do not add `retryOf` to Main until base selection, retained-worktree behavior,
attempt caps, and UI actions are specified.

### P2 - Atomic replacement is not full crash durability

Temporary-file plus rename prevents partial JSON visibility, but the branch
does not `fsync` the file and containing directory. Exclusive creation uses a
hard-link publication technique. These choices need explicit Windows,
external-volume, and network-filesystem validation.

The documented guarantee should say atomic publication unless stronger
power-loss durability is implemented and tested.

### P2 - One Host per data root is assumed, not enforced

Per-run serialization is process-local. Two Host processes pointing at the
same `~/.piwin` root can race on manifests and repository integration.

The architecture already expects one Host authority. Production hardening
should enforce that assumption with a data-root ownership lock or an equivalent
single-writer admission mechanism.

### P2 - Recovery needs complete multi-client projection and UX

The branch logs recovery and updates child session state, but production
completion also requires:

- recovered invocation projection in Host snapshots/replay;
- consistent Desktop, CLI, mobile, and Web status;
- a visible retained-worktree path;
- explicit retry, continue, inspect, integrate, and cleanup actions;
- redacted, actionable failure copy.

### P3 - Branch hygiene is poor

The branch is one WIP commit and mixes contracts, Host Runtime, worker, Git,
session persistence, CLI/Tauri wiring, documentation, skills, E2E, and an
unrelated pet manifest type fix. Even if no semantic conflicts existed, this
would be too large and cross-cutting to merge as one review unit.

### P3 - Cancel IPC reports success for unknown or terminal runs

The cancellation command discards the durable marker result and reports
`cancelled: true` even when the run is unknown or already terminal. Clients
need distinct accepted, already-terminal, and not-found outcomes.

## 7. Is the functionality necessary?

### Necessary before a production-ready claim

- cancellation that cannot later mutate the parent while queued;
- recoverable integration transaction/checkpoint semantics;
- enforced single-Host ownership of one data root;
- strict manifest persistence;
- no-lost-update serialization;
- crash/startup reconciliation;
- recovery admission gate;
- structured and redacted failures;
- retained worktree evidence;
- deterministic recovery tests.

These are not optional polish if piwin claims dependable parallel subagent
execution.

### Valuable but can follow later

- model-triggered explicit semantic retry;
- dedicated recovery UI actions;
- credentialed multi-model release gate;
- cross-platform filesystem durability hardening.

### Already sufficiently implemented on Main

- alternate-index Git snapshot and three-way integration;
- parent staging-index preservation;
- untracked/binary/rename handling;
- worktree and generated branch cleanup;
- basic real-worker worktree E2E.

## 8. Recommended forward-port sequence

1. **Write the additive contract/spec first.** Define live `RunRegistry`
   authority versus durable recovery projection, retry versus continuation,
   redaction, and supported manifest versions.
2. **Fix cancellation and integration transactions.** Make queued integration
   cancellable, define the parent-mutation commit point, add an `applying`
   journal/checkpoint, and reconcile patch identity after crashes.
3. **Enforce one Host owner per data root.** Add a Host identity and ownership
   lock/lease before any startup process can recover or mutate manifests.
4. **Keep Main's current contracts.** Add failure/recovery fields without
   deleting invocation, continuation, provider-auth, and secret-bootstrap
   fields.
5. **Port persistence primitives.** Safe IDs, complete parsing, exclusive
   creation, serialized mutation, atomic replacement, explicit permissions,
   and migrations.
6. **Port startup reconciliation.** Terminalize abandoned tasks, retain
   uncertain worktrees, update session and invocation projections, then open
   admission.
7. **Add structured failure mapping and redaction.** Cover admission,
   workspace, preparation, worker start, execution, integration, cleanup,
   cancellation, and recovery.
8. **Add deterministic crash-injection tests.** Cover cancellation while
   waiting for the integration slot and crashes before/after
   lease, running checkpoint, worker completion, parent apply, durable applied
   checkpoint, and cleanup.
9. **Harden workspace/output contracts.** Use collision-resistant worktree
   identities, reject stale branches, and distinguish unrestricted output from
   an empty deny-all allowlist.
10. **Design retry after continuation.** Enforce `retryable`, preserve root
   lineage, cap attempts, and decide base/worktree policy.
11. **Extend current Main E2E.** Keep secret-bootstrap and invocation behavior;
   make provider IDs configurable and keep credentialed runs opt-in.
12. **Land as small commits.** Suggested split: docs/contracts, cancellation,
   integration journal, Host ownership, store,
   recovery wiring, failure projection, retry, E2E/UX.

## 9. Merge gate

- [ ] No wholesale merge or cherry-pick of `f1b56bf`.
- [ ] Preserve current Main invocation, continuation, and secret-bootstrap
      contracts.
- [ ] Full schema validation and version migration tests.
- [ ] Corrupt or future manifests fail visibly.
- [ ] No provider secret or unredacted sensitive error is persisted.
- [ ] Concurrent sibling completion cannot lose state.
- [ ] Cancellation while waiting for integration cannot mutate the parent.
- [ ] Crash after parent apply can be reconciled without duplicate apply or
      loss of evidence.
- [ ] Recovery completes before new batch admission.
- [ ] Recovery never replays provider or file-writing execution.
- [ ] Retry eligibility is Host-enforced and distinct from continuation.
- [ ] Retained worktrees remain inspectable and cleanup is idempotent.
- [ ] Single-Host ownership of one data root is enforced.
- [ ] Worktree path, branch, repository, and captured base ownership are
      validated before reuse or forced cleanup.
- [ ] Empty output restrictions cannot become unrestricted access.
- [ ] Push delivery failures cannot rewrite successful execution truth.
- [ ] Windows/external-filesystem publication and watcher behavior is tested.
- [ ] Multi-client snapshots/replay expose recovered invocation state.
- [ ] Root typecheck, architecture checks, focused package tests, Host JSONL
      smoke, and relevant client tests pass.
- [ ] ADR 0030, runtime spec, dev plan, and canonical backlog agree on status.

## 10. Final recommendation

**Merge necessity:** no for the branch; yes for selected hardening concepts.

**Recommended action:** reject a direct merge, preserve Main's evolved runtime,
and selectively forward-port the strict run-store and structured failure
design. Do not enable the branch recovery path until cancellation, integration
crash consistency, and Host ownership fencing are fixed. Semantic retry should
remain a separate follow-up after retry/continue/repair semantics are explicit.

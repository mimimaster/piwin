# Model-facing subagent delivery/review loop — executable plan

| Field | Value |
|---|---|
| Status | In progress |
| Date | 2026-09-13 |
| Required base | `feat/async-subagents@0e5727cd3a766767c08adacca6ae623229ff8ab8` |
| Actual base | `0e5727cd3a766767c08adacca6ae623229ff8ab8` (this worktree, `codex/subagent-review-loop`) |
| Scope | Candidate-producing worker, independent reviewer, targeted continuation, review-bound apply, final verification, Desktop projection |
| Related | ADR 0030, ADR 0046, ADR 0050, ADR 0069; `docs/specs/2026-08-30-subagent-delivery-review-adjustment.md`; `docs/plans/2026-09-12-model-facing-async-subagents.md` |

## 1. Deliverable outcome

Ship one complete, model-facing delivery loop on top of the finished async
subagent control surface:

```text
main/composer
  -> worker writes in an isolated worktree and returns candidate v1
  -> reviewer reads the exact frozen v1 diff and submits a structured decision
  -> if changes requested, the same worker session continues in the retained worktree
  -> continuation freezes candidate v2; v1 approval can no longer authorize apply
  -> reviewer approves the exact v2 result
  -> main applies v2 through the existing serialized integration path
  -> main verifies the integrated parent workspace
  -> main reports the result and evidence to the user
```

The main model remains the planner and loop controller. The Host owns identity,
version binding, authorization, persistence, quotas, cancellation, workspace
leases, and code integration. This is a narrow reviewed-delivery protocol, not
a generic workflow engine or a hard-coded DAG runner.

The first release is complete when a user can ask for an implementation once,
watch worker/reviewer roles use separately configured models, receive at most
two bounded repair rounds, and get a final answer only after the approved
candidate has been applied and verified in the parent workspace.

## 2. Baseline and gaps that must be closed

The required base already provides:

- `piwin_subagent_run`, `piwin_subagent_start`, `piwin_subagent_wait`, and
  `piwin_subagent_cancel`;
- durable batch manifests and invocation projections;
- model/profile/thinking selection per orchestration-scheme role;
- readonly and isolated-worktree children;
- frozen `SubagentResultRef` / `ChangeVersionRef` values;
- explicit candidate delivery, result file/diff Host commands, serialized
  integration, workspace write gate, and retained child continuation;
- transcript invocation cards, lifecycle rows, and the Desktop Tasks panel;
- structured parent settlement if the model forgets to wait.

The missing links are specific and should be fixed rather than replaced:

1. `piwin_subagent_wait` does not return the frozen `resultRef`, so the parent
   cannot address the exact candidate it just collected.
2. Result inspection and apply exist for shells/UI, but are not safe scoped
   model tools.
3. `subagent/continue` is a shell command. It is not bound to the originating
   parent Run, scheme admission, a predecessor result, or reviewer findings.
4. There is no durable structured review record. A prose reviewer report
   cannot safely authorize a write.
5. `persistSubagentTaskResult()` currently reconstructs result metadata with
   placeholder values (`deliveryIntent='integrate'`, no candidate group, empty
   workspace id), and `SubagentResultService` keeps apply/group state only in
   memory. This is not sufficient authority for reviewed apply or restart.
6. Existing `candidateGroupId` means mutually exclusive alternatives. It must
   not be overloaded to mean v1/v2 repair lineage.
7. Desktop can show a task and candidate, but not “reviewing v2”, structured
   findings, stale approval, or the worker → reviewer → repair relationship.

These are prerequisites inside this plan, not deferred cleanup.

## 3. Product decisions

### 3.1 Roles and model assignment

Add one built-in `reviewed-delivery` orchestration scheme and keep custom
schemes fully supported. Its default roster is:

| Role | Purpose | Isolation | Default model policy |
|---|---|---|---|
| `worker` | Implement or repair one bounded change | `worktree` | inherit parent unless user pins a model |
| `reviewer` | Inspect the frozen candidate and submit a decision | `readonly` | inherit parent unless user pins a different model |

The scheme editor continues to own role → profile/model/thinking assignment.
No provider/model names are hard-coded. The built-in defaults work without
configuration; the user can deliberately use a faster worker and a stronger
reviewer.

The parent/composer is not another child role. It decomposes work, starts the
roles, interprets the structured decision, and owns the user-facing answer.

### 3.2 Loop policy

- Every implementation worker starts with `deliveryIntent='candidate'`,
  `applyPolicy='explicit'`, `isolation='worktree'`, and `retainWorktree=true`.
- A reviewer must target one exact `SubagentResultRef`. It cannot review “the
  latest child” or infer a result from session title.
- `changes-requested` may continue the original terminal worker session in its
  retained worktree. The continuation produces a new result id in the same
  candidate lineage and points to its exact predecessor.
- A review authorizes only its exact target result and frozen change version.
- Model-driven repair is capped at two continuation rounds per lineage. After
  that, or on `blocked`, the parent stops the loop and explains the blocker.
- Apply is allowed only for the current lineage head with an `approved` review
  bound to that exact result.
- After apply, the parent runs the repository's relevant verification against
  the parent workspace. Review is not a substitute for post-integration tests.
- Verification failure ends as “applied but verification failed”; it does not
  silently revert, recursively retry, or claim completion. The existing
  turn-change undo/recovery surface remains the explicit recovery mechanism.

### 3.3 Reviewer contract

The reviewer is independent from the worker and receives:

- a Host-authored provenance block identifying the exact result and change
  version;
- the original bounded task statement and declared output paths;
- read access to repository context;
- scoped result-summary/file/diff tools for only the target result;
- one structured submission tool.

The reviewer checks correctness, regressions, scope, tests, security, and
architecture rules. It must submit one of:

- `approved`: no blocking finding remains;
- `changes-requested`: repairable findings are present;
- `blocked`: the candidate cannot be responsibly judged or repaired within
  the current authority/scope.

Reviewer prose remains useful evidence but never grants apply authority. Only
the durable structured review record does.

### 3.4 User experience

The existing transcript and Tasks surfaces are extended, not replaced:

```text
实现：登录状态修复             已产出候选 v1
  └─ 审查：候选 v1             需修改 · 2 项
      └─ 返工：登录状态修复     已产出候选 v2
          └─ 审查：候选 v2      已批准
              └─ 集成与验证     已通过
```

Each row keeps its own invocation/run identity. The indentation/relationship
is a derived presentation from durable references; no new mutable UI-only
workflow state is introduced. Raw ids stay in copyable details.

## 4. Explicit non-goals

- No generic stage-machine, visual DAG editor, swarm protocol, peer-to-peer
  communication, shared scratchpad, or arbitrary workflow scripting.
- No detached work that outlives the owning foreground Run.
- No nested subagents below depth one.
- No automatic model router, benchmark-driven provider selection, or new model
  catalog.
- No multi-reviewer quorum, adversarial debate, or automatic PR creation.
- No reviewer access to arbitrary results from the same project/session.
- No direct patch text embedded into prompts by default; large diffs remain
  paged Host data.
- No automatic rollback after a failed final verification.
- No change to Pi packages and no Pi import outside `packages/agent-host`.

## 5. Authority and state model

### 5.1 Durable source-of-truth records

Use existing subagent run manifests plus turn-change operation storage. Do not
add a second scheduler or an in-memory-only review database.

1. Worker `SubagentRunManifest` persists delivery intent, workspace target,
   candidate lineage, predecessor, result ref, and frozen child changes.
2. Reviewer `SubagentRunManifest` persists review target and the submitted
   `SubagentReviewRecord` before the submit tool reports success.
3. Turn-change storage remains authoritative for frozen file objects and the
   actual parent-workspace apply transaction.
4. `SubagentResultService` becomes a restart-rebuildable projection/cache over
   manifests plus operation facts. Its maps and mutex may optimize one process
   but must not be the only record of apply, selection, or approval.
5. Desktop state is a revision-aware projection rebuilt from Host snapshots
   and pushes.

### 5.2 New contract types

Add a named `packages/contracts/src/subagent-review.ts` module:

```ts
export type SubagentReviewDecision =
  | 'approved'
  | 'changes-requested'
  | 'blocked';

export type SubagentReviewSeverity = 'critical' | 'high' | 'medium' | 'low';

export type SubagentReviewFinding = {
  id: string;
  severity: SubagentReviewSeverity;
  title: string;
  detail: string;
  relativePath?: string;
  line?: number;
  evidence?: string;
};

export type SubagentReviewRef = {
  reviewId: string;
  revision: number;
};

export type SubagentReviewRecord = {
  reviewId: string;
  revision: number;
  parentSessionId: string;
  reviewerSessionId: string;
  reviewerRunId: string;
  targetResult: SubagentResultRef;
  targetChanges: ChangeVersionRef;
  decision: SubagentReviewDecision;
  findings: SubagentReviewFinding[];
  verification: Array<{
    label: string;
    status: 'passed' | 'failed' | 'not-run';
    evidence?: string;
  }>;
  createdAt: string;
};

export type SubagentVerificationRef = {
  verificationId: string;
  revision: number;
};

export type SubagentDeliveryVerification = {
  verificationId: string;
  revision: number;
  parentSessionId: string;
  parentRunId: string;
  result: SubagentResultRef;
  approvedBy: SubagentReviewRef;
  applyOperationId: string;
  appliedChanges: ChangeVersionRef;
  status: 'passed' | 'failed';
  checks: Array<{
    label: string;
    status: 'passed' | 'failed';
    evidence: string;
  }>;
  createdAt: string;
};
```

Bounds are contract behavior:

- findings: maximum 50;
- title: 160 characters;
- detail/evidence: 2,000 characters each;
- verification entries: maximum 20;
- delivery-verification checks: maximum 20, with 2,000-character evidence;
- relative paths must match the frozen result file list;
- line numbers must be positive integers when present.

Extend candidate/result contracts with separate repair lineage fields:

```ts
type SubagentResultSummary = {
  // existing fields unchanged
  candidateLineageId: string | null;
  candidateGeneration: number | null;
  predecessorResult: SubagentResultRef | null;
  latestReview: SubagentReviewRef | null;
  reviewStatus: 'not-requested' | 'pending' | 'approved'
    | 'changes-requested' | 'blocked' | 'stale';
  latestVerification: SubagentVerificationRef | null;
};
```

`candidateGroupId` keeps its current alternatives-only meaning. A candidate
may have both a group id and a lineage id, but they solve different problems.

Extend `SubagentTaskSpec`, `SubagentTaskResult`, persisted manifest task data,
and `SubagentInvocation` only with the minimum references needed:

```ts
type SubagentReviewTarget = {
  result: SubagentResultRef;
  changes: ChangeVersionRef;
};

// optional fields on the relevant existing records
reviewTarget?: SubagentReviewTarget;
reviewRef?: SubagentReviewRef;
candidateLineageId?: string;
candidateGeneration?: number;
predecessorResult?: SubagentResultRef;
```

Add one capability bit, `subagentReviewLoopV1`. New Desktop affordances are
shown only when the Host advertises it; old clients continue to see ordinary
subagent/result rows.

### 5.3 Derived phases, not a second workflow authority

Desktop may derive this display-only phase:

```ts
type SubagentDeliveryLoopPhase =
  | 'producing-candidate'
  | 'awaiting-review'
  | 'changes-requested'
  | 'repairing'
  | 'approved'
  | 'applying'
  | 'verifying'
  | 'delivered'
  | 'blocked';
```

It is computed from run/invocation, result, review, and integration facts. It
is never independently written to disk or accepted from a model/client.

## 6. Model-facing tool contracts

Register the following tools in the existing `delegate` family for SDK and
worker-backed parent sessions. Reviewer-only tools are added to the reviewer
child's compiled surface through Host-scoped review context, not globally.

### 6.1 Extend `piwin_subagent_start`

Add:

```ts
type SubagentStartInput = ExistingSubagentStartInput & {
  reviewOf?: SubagentResultRef;
};
```

Rules:

- `reviewOf` requires a scheme role whose resolved isolation is `readonly`.
- Host resolves the result, validates same parent session and current access,
  freezes `targetChanges`, and stores `reviewTarget` in the reviewer manifest.
- A candidate with missing/expired frozen data cannot enter review.
- The model cannot provide parent session/run, workspace path, change-set id,
  lineage id, or review capability scope.

### 6.2 Extend `piwin_subagent_wait`

Each terminal observation adds bounded structured references:

```ts
type SubagentWaitRunObservation = ExistingObservation & {
  resultRef?: SubagentResultRef;
  childChanges?: ChangeVersionRef;
  reviewRef?: SubagentReviewRef;
  reviewDecision?: SubagentReviewDecision;
};
```

This is the handoff between loop steps. Text output includes a compact human
summary, but the parent model does not scrape ids or decisions from prose.

### 6.3 `piwin_subagent_result_read`

Reviewer-scoped, read-only tool:

```ts
type SubagentResultReadInput =
  | { mode: 'summary'; result: SubagentResultRef }
  | { mode: 'files'; result: SubagentResultRef; cursor?: string; limit?: number }
  | { mode: 'diff'; result: SubagentResultRef; fileId: string };
```

- It accepts only the exact `reviewTarget.result` bound by the Host.
- It reuses `SubagentResultService.get/listFiles/diffFile`; no arbitrary path
  or worktree path is exposed.
- Lists and patches are bounded and advertise `truncated`/`nextCursor`.
- Binary files return metadata only.
- A stale, cleaned, foreign, or unscoped result fails closed with a stable
  code.

### 6.4 `piwin_subagent_review_submit`

Reviewer-scoped metadata mutation:

```ts
type SubagentReviewSubmitInput = {
  target: SubagentResultRef;
  decision: SubagentReviewDecision;
  findings: SubagentReviewFinding[];
  verification: SubagentReviewRecord['verification'];
};
```

- Exactly one successful submission is allowed per reviewer Run. Identical
  retries return the same `reviewRef`; a different payload is rejected.
- Host supplies ids, target change ref, parent/reviewer identity, timestamps,
  and revision.
- The record is persisted to the reviewer manifest before success is returned.
- `approved` rejects critical/high findings. `changes-requested` requires at
  least one finding. `blocked` requires a reason finding.
- A reviewer Run that terminates without submission remains execution-complete
  but review-missing; wait returns no `reviewRef`, and apply stays unavailable.

### 6.5 `piwin_subagent_continue`

Parent-only, model-facing continuation:

```ts
type SubagentContinueInput = {
  childSessionId: string;
  expectedResult: SubagentResultRef;
  review: SubagentReviewRef;
  task: string;
};
```

Host validates atomically before accepting:

- child belongs to the current parent session and is terminal;
- expected result is the current head of that child's candidate lineage;
- review targets that exact result and decision is `changes-requested`;
- retained worktree lease still exists and matches the original managed
  worktree identity;
- repair count is below two;
- originating parent Run admission is open and scheme task/concurrency quotas
  can be acquired;
- cancellation has not won.

The continuation reuses child identity/model/profile/history/worktree, injects
a Host-authored block containing the structured findings, and starts one new
batch Run. It preserves candidate delivery, creates generation N+1 only when
the continuation settles and freezes successfully, and never auto-applies.

The existing shell `subagent/continue` remains compatible. Its manual path is
not silently upgraded to model review semantics.

### 6.6 `piwin_subagent_result_apply`

Parent-only write tool:

```ts
type SubagentResultApplyInput = {
  result: SubagentResultRef;
  approvedBy: SubagentReviewRef;
};
```

Before writing, Host revalidates:

- same parent session and target workspace;
- result is complete, stable, present, unapplied, and current lineage head;
- review is durable, `approved`, and targets exactly this result and its frozen
  `childChanges`;
- no newer candidate or stale review exists;
- candidate-group selection permits this member;
- project trust, file-write permission, workspace write gate, and integration
  preconditions pass.

The tool reuses the existing integration coordinator and turn-change operation
store. It must not call a second patch writer. Apply is idempotent for the same
tool call/request fingerprint. Transport timeout returns “outcome unknown” and
the same operation is reconciled; it never starts a second write.

### 6.7 `piwin_subagent_verification_submit`

Parent-only metadata tool used after the parent runs ordinary repository
verification against the integrated workspace:

```ts
type SubagentVerificationSubmitInput = {
  result: SubagentResultRef;
  approvedBy: SubagentReviewRef;
  applyOperationId: string;
  status: 'passed' | 'failed';
  checks: Array<{
    label: string;
    status: 'passed' | 'failed';
    evidence: string;
  }>;
};
```

- Host resolves `appliedChanges`; the model cannot provide or replace it.
- Result, approval, operation, current parent Run, and applied change must form
  one valid chain.
- `passed` requires at least one check and no failed check. `failed` requires
  at least one failed check.
- The bounded verification record is persisted before success and returned as
  `SubagentVerificationRef`.
- This tool records evidence; it does not execute shell commands or grant
  write authority. Actual checks continue through normal permissioned tools.
- The parent may produce the final user-facing answer (and optional
  `WalkthroughArtifact`) only after this record exists. A failed record yields
  an incomplete/attention result, never “delivered”.

## 7. Hard invariants and failure semantics

1. **Exact version binding:** review target = apply target = frozen change
   version. Any mismatch returns `stale-review` before mutation.
2. **Lineage head only:** once v2 exists, v1 remains inspectable but cannot be
   newly reviewed, continued, or applied by the model.
3. **No prose authority:** child/reviewer text is untrusted data. Host-generated
   context labels it as evidence and structured fields drive decisions.
4. **One writer:** all parent-workspace writes use the existing integration
   coordinator and workspace write gate.
5. **Durable before visible:** candidate/review/apply facts persist before a
   success tool result or terminal push is emitted.
6. **Restart safety:** Host restart reconstructs result heads, review links,
   and apply outcome before admitting an overlapping apply/continue.
7. **Cancellation wins:** parent Stop/failure/pause/replacement cancels active
   reviewer/repair descendants and never auto-starts the next loop step.
8. **Bounded repair:** two model continuations maximum; no hidden unbounded
   reviewer-worker ping-pong.
9. **Independent axes:** worker execution, summary merge, review, integration,
   and verification remain separate facts.
10. **No false completion:** final parent answer must distinguish approved,
    applied, and verified. “Reviewer approved” alone is not delivered, and the
    delivered phase requires a durable passed verification record.

Stable new refusal codes:

| Code | Meaning / next action |
|---|---|
| `review-target-not-found` | Refresh result state; do not guess another result |
| `review-target-forbidden` | Target is outside the reviewer/parent scope |
| `review-data-expired` | Frozen content is unavailable; cannot approve/apply |
| `review-missing` | Reviewer ended without a structured submission |
| `stale-review` | Review does not authorize the current candidate head |
| `candidate-superseded` | Inspect the newer generation |
| `repair-limit-reached` | Stop and report findings to the user |
| `continuation-worktree-missing` | Preserve evidence; start no replacement silently |
| `result-not-approved` | Run/collect a valid reviewer first |
| `apply-outcome-unknown` | Reconcile the existing operation; never duplicate it |

Existing `stale-revision`, `already-applied`, `candidate-group-selected`,
`workspace-busy`, `integration-conflict`, `needs-repair`, and permission codes
remain unchanged.

## 8. Implementation work packages

All work starts from the required base. Contracts land before implementers.
Each package below is independently reviewable and has an explicit exit gate.

### B0 — Reconcile the completed async branch and freeze the vertical slice

Files:

- this plan
- `docs/specs/2026-08-30-subagent-delivery-review-adjustment.md`
- `docs/adr/0030-safe-parallel-subagent-execution.md`

Work:

- Create `codex/subagent-review-loop` from the integrated commit containing
  `0e5727cd`; record the actual base SHA in the delivery note.
- Re-run the focused async-subagent tests before changing behavior.
- Update the spec/ADR wording to state that model-facing async control is
  complete and this slice adds reviewed model-driven delivery.
- Keep generic result-review/manual candidate behavior intact.

Exit gate: clean async baseline; no implementation begins from old `main`.

### B1 — Persist correct result metadata and candidate lineage

Files:

- `packages/contracts/src/subagent-review.ts` (new)
- `packages/contracts/src/subagent-result.ts`
- `packages/contracts/src/subagent-orchestration.ts`
- `packages/contracts/src/index.ts`
- `packages/session/src/subagent-run-store.ts`
- `packages/session/src/subagent-run-store.test.ts`
- `packages/host-runtime/src/subagent-result-freeze.ts`
- `packages/host-runtime/src/host-runtime-subagent.ts`
- `packages/host-runtime/src/subagent-result-service.ts`
- focused tests beside those modules

Work:

- Add the review/lineage contracts and public exports.
- Persist delivery intent, apply policy, target workspace, candidate group,
  lineage, predecessor, result ref, and child changes in the run manifest.
- Remove placeholder reconstruction in `persistSubagentTaskResult()`; build the
  summary from the admitted task/runtime/result facts.
- Rebuild the result projection from manifests on Host startup.
- Mark previous generation review status stale when a newer candidate freezes.
- Keep legacy manifests readable with explicit `legacyManual`/unavailable
  actions; do not invent approval or candidate lineage for them.

Necessary tests:

1. candidate metadata survives store round-trip and Host restart;
2. continuation v2 links to v1 with a distinct result id;
3. v2 makes v1 non-head without mutating v1 frozen content;
4. legacy manifest migration cannot make a result more writable;
5. candidate group and candidate lineage remain independent.

Exit gate: the Host can restart and reconstruct the same candidate head and
availability without relying on `SubagentResultService` process memory.

### B2 — Make apply reservation and reconciliation durable

Files:

- `packages/git/src/turn-changes/operation-store.ts`
- `packages/git/src/turn-changes/operation-runner.ts`
- `packages/host-runtime/src/subagent-result-service.ts`
- `packages/host-runtime/src/subagent-integration-coordinator.ts`
- `packages/host-runtime/src/host-runtime-init.ts`
- focused operation/result/integration tests

Work:

- Reuse the existing turn-change operation/idempotency storage for
  `subagent-apply`; do not create a JSON mutex log.
- Persist reservation for result id and optional alternative candidate group
  before the first workspace write.
- Reconcile operation status before result projections during Host startup.
- Keep the in-process serializer as contention optimization only.
- If an operation crashes after disk write but before projection update,
  recovery updates the result as applied without replaying file writes.

Necessary tests:

1. same apply fingerprint replays one operation id;
2. concurrent same-result and same-group applies produce one writer;
3. restart after reservation rejects an overlapping apply;
4. restart after file write reconciles success without a second write;
5. failed pre-write validation releases reservation; `needs-repair` does not.

Exit gate: duplicate model/UI/client requests cannot apply twice, including
across restart.

### B3 — Add scoped review context and result-read tool

Files:

- `packages/host-runtime/src/subagent-tool-input.ts`
- `packages/host-runtime/src/subagent-start-tool.ts`
- `packages/host-runtime/src/host-runtime-subagent-start.ts`
- new `packages/host-runtime/src/subagent-result-read-tool.ts`
- new `packages/host-runtime/src/subagent-review-context.ts`
- `packages/host-runtime/src/tools/build-session-host-tools.ts`
- `packages/host-runtime/src/host-runtime-tool-surfaces.test.ts`
- focused tool tests

Work:

- Parse `reviewOf` and bind its validated target during reviewer admission.
- Carry a Host-only review capability scope into the reviewer session runtime.
- Compile `piwin_subagent_result_read` only when that scope exists.
- Reuse existing summary/files/diff methods with pagination, truncation, binary
  handling, path checks, and stable errors.
- Inject bounded Host-authored review provenance into the first reviewer
  message. Do not append it as user-authored text.

Necessary tests:

1. reviewer can read summary, file list, and diff for its exact target;
2. another result in the same session is denied;
3. parent/ordinary child sessions do not receive reviewer-only tools;
4. stale revision, unknown file id, binary, and truncated patch degrade safely;
5. SDK and worker reviewer sessions expose the same scoped surface.

Exit gate: an independent reviewer can inspect one candidate without arbitrary
filesystem paths or broad result access.

### B4 — Persist structured reviewer decisions

Files:

- new `packages/host-runtime/src/subagent-review-submit-tool.ts`
- new `packages/host-runtime/src/subagent-review-service.ts`
- `packages/session/src/subagent-run-store.ts`
- `packages/host-runtime/src/host-runtime-subagent.ts`
- `packages/host-runtime/src/tools/build-session-host-tools.ts`
- review service/tool tests

Work:

- Validate bounds and decision/finding consistency.
- Persist the review record into the reviewer manifest before returning.
- Project review status/latest review onto the exact target result and publish
  `subagent/result-updated` plus reviewer invocation updates.
- Include `reviewRef`/decision in wait observations.
- Make duplicate identical submit idempotent and conflicting resubmit fail.

Necessary tests:

1. approved/changes-requested/blocked validation matrix;
2. successful submit survives restart and wait returns the same review ref;
3. reviewer completion without submit cannot authorize apply;
4. a decision for an unscoped/stale result is rejected;
5. one reviewer Run cannot submit two different decisions.

Exit gate: reviewer output is a durable, version-bound fact rather than prose.

### B5 — Add review-bound model continuation

Files:

- new `packages/host-runtime/src/subagent-continue-tool.ts`
- `packages/host-runtime/src/host-runtime-subagent-tasks.ts`
- `packages/host-runtime/src/host-runtime-subagent-start.ts`
- `packages/host-runtime/src/orchestration-scheme-admission.ts`
- `packages/host-runtime/src/subagent-parent-settlement.ts`
- continuation/admission/settlement tests

Work:

- Extract the existing retained-session continuation preparation into one
  shared Host function used by shell and model paths.
- Add model-only validation for current result head, review decision, parent
  Run ownership, repair count, open admission, and cancellation.
- Acquire scheme admission before acceptance and hold it for the full child
  lifetime, exactly like async start.
- Inject structured findings with Host provenance and preserve the worker's
  model/profile/history/worktree.
- Freeze the repaired result as the next candidate generation.
- Ensure parent settlement joins an accepted repair/reviewer like any other
  direct child; settlement never invents another repair step.

Necessary tests:

1. changes-requested continues the same child/worktree and creates v2;
2. approved/blocked/missing review cannot continue;
3. stale v1 request after v2 is rejected before batch admission;
4. two repairs succeed and the third returns `repair-limit-reached`;
5. task/concurrency caps include continuations;
6. parent Stop between validation and acceptance starts no continuation;
7. shell continuation remains compatible.

Exit gate: the parent can direct one exact worker to repair one exact reviewed
candidate without bypassing structured-concurrency limits.

### B6 — Add review-bound model apply

Files:

- new `packages/host-runtime/src/subagent-result-apply-tool.ts`
- `packages/host-runtime/src/subagent-result-service.ts`
- `packages/host-runtime/src/subagent-integration-coordinator.ts`
- `packages/host-runtime/src/tools/build-session-host-tools.ts`
- `packages/host-runtime/src/tools/tool-loop-progress.ts`
- `packages/host-runtime/src/host-runtime-tool-surfaces.test.ts`
- focused apply/tool/permission tests

Work:

- Validate the exact result/review/change triple immediately before mutation.
- Route permission through the existing file-write gate and use the existing
  integration coordinator/operation store.
- Return operation id, result ref, applied change ref, and terminal integration
  status as structured details.
- Publish result/invocation/workspace updates through existing HostPush types.
- Classify apply as progress and write-capable; read/submit/wait stay neutral.

Necessary tests:

1. approved current head applies once;
2. v1 approval cannot apply v2, and v1 cannot apply after v2 exists;
3. missing/blocked/changes-requested review cannot apply;
4. permission denial and workspace busy perform zero writes;
5. conflict retains candidate and produces `needs-integration`;
6. timeout/retry reconciles one durable operation;
7. UI apply and model apply share the same service-level invariant checks.

Exit gate: only an exact durable approval can trigger one serialized apply.

### B7 — Persist post-integration verification

Files:

- new `packages/host-runtime/src/subagent-verification-submit-tool.ts`
- `packages/host-runtime/src/subagent-result-service.ts`
- `packages/session/src/subagent-run-store.ts`
- `packages/host-runtime/src/tools/build-session-host-tools.ts`
- focused verification/tool tests

Work:

- Validate and persist `SubagentDeliveryVerification` against the exact
  result/review/apply operation/applied change chain.
- Project the latest verification onto the result and publish a result update.
- Include verification ref/status in normalized apply/delivery presentation.
- Treat failed verification as durable attention, not integration rollback.
- Keep verification execution in ordinary parent tools; this tool only closes
  and records the evidence loop.

Necessary tests:

1. a passed record requires a successfully applied exact result;
2. stale review, foreign operation, wrong parent Run, or no applied changes is
   rejected;
3. passed/failed check consistency is validated and bounded;
4. identical retry returns the same ref; conflicting retry is rejected;
5. verification status survives restart and reconnect.

Exit gate: Desktop and the parent can durably distinguish applied from verified.

### B8 — Add the reviewed-delivery scheme and model guidance

Files:

- `packages/contracts/src/orchestration-scheme.ts`
- `packages/contracts/src/orchestration-scheme.test.ts`
- `packages/host-runtime/src/config-store.ts`
- Settings fixtures/migration tests
- `docs/specs/orchestration-scheme.md`

Work:

- Add the built-in `reviewed-delivery` roster with worker/reviewer roles.
- Instruct the parent to use candidate delivery, collect result refs, start an
  independent review, continue only on structured changes-requested, apply
  only exact approval, verify after integration, and submit the verification
  record before claiming delivery.
- State the two-repair cap and termination behavior.
- Instruct the reviewer that submission is mandatory and prose is secondary.
- Preserve custom scheme model/profile/thinking overrides and old settings.

Necessary tests:

1. built-in scheme resolves valid roles and compatible isolation;
2. prompt names all required tools and no generic infinite loop;
3. pinned worker/reviewer models stay distinct through preparation;
4. unavailable role follows configured fallback without model substitution;
5. old settings load unchanged.

Exit gate: the feature works out of the box and supports deliberate per-role
model assignment.

### B9 — Normalize tool presentation

Files:

- `packages/contracts/src/subagent-tool-presentation.ts`
- `packages/agent-host/src/subagent-presentation.ts`
- `packages/agent-host/src/subagent-presentation.test.ts`
- `packages/agent-host/src/tool-presentation.ts` only for small wiring

Work:

- Add structured presentation kinds for result read, review submit,
  continuation, and apply.
- Preserve result/review/invocation refs as linking metadata while bounding
  all user-facing summaries.
- Never make result-read or review-submit create another child topology card.
- Mark continuation as the same child identity with a new Run/generation.

Exit gate: Desktop never parses raw tool text to infer review decisions or
relationships.

### F1 — Derive one review-loop view model

Files:

- new `apps/desktop/src/subagent-review-loop-view.ts`
- new `apps/desktop/src/subagent-review-loop-view.test.ts`
- `apps/desktop/src/subagent-orchestration-view.ts`
- minimal reducer wiring for review/result pushes

Work:

- Join invocation, result, lineage, review, and integration facts by ids.
- Derive phases, candidate generation labels, finding counts, stale approval,
  and attention state.
- Prefer highest Host revisions and prevent stale pushes regressing terminal
  facts.
- Keep the module pure and independent of React.

Necessary tests:

1. worker → reviewer → repair → reviewer relation is deterministic;
2. v2 marks v1 review stale;
3. approved, applied, and verified are not collapsed;
4. reconnect order and duplicate pushes produce one projection;
5. legacy candidates render without fake review state.

### F2 — Render the loop in transcript and Tasks panel

Files:

- `apps/desktop/src/subagent-invocation-block.tsx`
- `apps/desktop/src/SubAgentPanel.tsx`
- new `apps/desktop/src/subagent-review-summary.tsx`
- related component tests and a named CSS module

Work:

- Show candidate vN, reviewing, decision, finding count, repair, apply, and
  verification-attention states using existing `@piwin/ui-kit` primitives.
- Expand review details to a bounded severity-sorted finding list with safe
  relative file/line references.
- Keep manual Apply/Request resolution actions, but make availability and stale
  reasons come from Host facts.
- Reuse child-session navigation; no duplicate child transcript renderer.
- Add accessible labels, keyboard expansion, and non-color status text.

Necessary tests:

1. changes-requested findings expand under the correct candidate;
2. continuation remains the same worker identity with v2 label;
3. stale v1 approval disables apply and points to v2;
4. applied-but-verification-failed remains visibly incomplete;
5. old Host capability degrades to ordinary result cards.

### V1 — Integration harness, documentation, and delivery evidence

Files:

- new `packages/host-runtime/src/subagent-review-loop.integration.test.ts`
- relevant Desktop integration fixture
- `docs/adr/0030-safe-parallel-subagent-execution.md`
- `docs/adr/0046-inline-subagent-invocation-projection.md`
- `docs/adr/0069-workspace-write-gate.md`
- `docs/specs/2026-08-30-subagent-delivery-review-adjustment.md`
- `docs/specs/orchestration-scheme.md`
- new `docs/evidence/2026-09-XX-subagent-review-loop.md`
- this plan

Work:

- Add a deterministic fake-model integration test covering the whole protocol.
- Run one real-model Desktop smoke with different worker/reviewer models.
- Record exact commands, model assignments, run/result/review ids, screenshots,
  applied change ref, verification output, known limits, and base/head commits.
- Mark this plan complete only after all automated and manual gates pass.

Exit gate: another engineer can reproduce the delivered loop from the evidence
document without relying on chat history.

## 9. End-to-end test scenarios

### 9.1 Deterministic happy path with one repair

1. Parent starts worker candidate v1.
2. Wait returns v1 result/change refs.
3. Parent starts reviewer A targeting v1.
4. Reviewer reads two files and submits `changes-requested` with one high
   finding.
5. Parent continues original worker with the exact review.
6. Wait returns candidate v2 and predecessor v1.
7. Parent starts reviewer B targeting v2; reviewer submits `approved`.
8. Parent applies v2 with reviewer B's ref.
9. Parent executes a deterministic verification command in the parent
   workspace and reports its evidence.
10. Parent submits a passed verification record for the exact applied chain,
    then gives the final user-facing delivery.

Assertions: one worktree, two worker Runs in one child session, two reviewer
children, two frozen candidate results, one apply operation, one verification
record, no v1 write, and one coherent Desktop loop projection.

### 9.2 Approval becomes stale

Approve v1, then create v2 through an authorized continuation before apply.
Applying v1 or using the v1 approval for v2 must fail before any write.

### 9.3 Reviewer fails to submit

Reviewer execution completes with prose only. Wait reports execution complete
and review missing. Parent may start a replacement reviewer if task budget
allows; it may not apply.

### 9.4 Cancellation races

Stop during reviewer inspection, continuation admission, and apply queueing.
Reviewer/repair children settle cancelled. Apply performs zero writes if Stop
wins before the operation's write phase; once durable write begins, existing
operation semantics safely complete or recover.

### 9.5 Restart recovery

Restart after candidate freeze, after review submit, after apply reservation,
and after file write before result projection. Each restart restores one
candidate head, one review, and at most one apply operation.

### 9.6 Integration conflict and verification failure

- Conflict: preserve candidate/worktree, publish `needs-integration`, and do
  not claim applied/verified.
- Verification failure after successful apply: show applied + failed
  verification evidence; do not auto-undo or start a third repair loop.

## 10. Verification commands

Run focused checks after each package, then the whole workspace:

```bash
pnpm --filter @piwin/contracts test -- orchestration-scheme subagent-review
pnpm --filter @piwin/contracts typecheck

pnpm --filter @piwin/session test -- subagent-run-store
pnpm --filter @piwin/session typecheck

pnpm --filter @piwin/git test -- operation-store operation-runner
pnpm --filter @piwin/git typecheck

pnpm --filter @piwin/host-runtime test -- subagent-result-service subagent-result-read-tool subagent-review-submit-tool subagent-continue-tool subagent-result-apply-tool subagent-verification-submit-tool subagent-review-loop orchestration-scheme-admission subagent-parent-settlement host-runtime-tool-surfaces
pnpm --filter @piwin/host-runtime typecheck

pnpm --filter @piwin/agent-host test -- subagent-presentation tool-presentation
pnpm --filter @piwin/agent-host typecheck

pnpm --filter @piwin/desktop test -- subagent-review-loop-view subagent-invocation-block SubAgentPanel
pnpm --filter @piwin/desktop typecheck

pnpm typecheck
pnpm test
git diff --check
```

Use deferred promises/latches for races; no timing sleeps. Add fixture-based
tests once at the Host-owned boundary rather than duplicating SDK and worker
logic. Verify every touched source file remains below 1000 lines and split by
responsibility near 400 lines.

## 11. Manual Desktop smoke

Use one trusted disposable repository and an SDK-worker Host. Configure:

- scheme: `reviewed-delivery`;
- worker: one available implementation model;
- reviewer: a different available model;
- max concurrency: 2;
- max tasks per Run: at least 5;
- a task with a deterministic test and a seeded defect that reviewer v1 should
  catch.

Run these cases:

1. **One-repair delivery:** observe v1 → changes requested → same worker repair
   → v2 approved → applied → tests passed.
2. **Clean first pass:** reviewer approves v1; no continuation is created.
3. **Missing submit:** reviewer returns prose only; Apply remains unavailable.
4. **Stop:** stop while repairing; no next reviewer/apply begins.
5. **Reload:** reload after v1 review and after apply; the same loop and status
   rehydrate without duplicates.
6. **Conflict:** edit the same parent file before apply; conflict is retained
   and surfaced without overwriting the user's change.

Capture the transcript loop, Tasks panel, review findings, final diff, and test
output in the evidence document. Do not mark the feature complete from unit
tests alone.

## 12. Acceptance criteria

- Worker and reviewer roles can use distinct configured models, and the chosen
  identities are visible in durable invocation data and Desktop details.
- The worker always produces an unapplied candidate before review.
- Wait returns exact result/change/review references as structured details.
- Reviewer access is limited to one Host-bound result and cannot read arbitrary
  paths/results.
- Review submission is durable, bounded, idempotent, and survives Host restart.
- A repair continuation reuses the original worker session/worktree while
  creating a distinct result linked to its predecessor.
- Two repair rounds are allowed; a third is rejected without starting work.
- Old reviews cannot authorize a newer candidate, and superseded candidates
  cannot be model-applied.
- Apply requires exact durable approval and uses one existing serialized,
  permission-gated, recoverable integration path.
- Duplicate/concurrent/retried apply requests write at most once across restart.
- Delivered status requires a durable passed verification record bound to the
  exact result/review/apply/applied-change chain.
- Parent Stop/failure/pause/replacement prevents subsequent automatic loop
  steps and settles active descendants.
- Desktop presents one connected worker/reviewer/repair chain without parsing
  raw tool text or duplicating child cards.
- Final parent output distinguishes reviewed, applied, and verified, and cites
  actual verification evidence.
- SDK and worker modes expose equivalent Host-owned behavior.
- CLI remains functionally consistent through structured tool text/Host
  commands; rich nesting is an intentional Desktop-only presentation.
- Contracts, focused tests, root typecheck/test, line-count check, docs, ADRs,
  and the real-model evidence record are complete.

## 13. Execution order and parallelization

```text
B0 base/spec lock
  -> B1 durable result metadata + lineage
      -> B2 durable apply reservation
      -> B3 scoped review read
          -> B4 structured review submission
              -> B5 review-bound continuation
              -> B6 review-bound apply (after B2 + B4)
                  -> B7 durable post-integration verification
                      -> B8 reviewed-delivery scheme
                      -> B9 normalized presentation
                      -> F1 pure Desktop projection
                          -> F2 Desktop rendering
                              -> V1 integration + real-model evidence
```

Safe parallel work after B1 contracts are merged:

- B2 operation durability and B3 scoped read can run in parallel.
- B5 continuation and B6 apply can run in parallel after B4, with B6 also
  depending on B2.
- B8 guidance and B9 presentation fixtures can run in parallel after tool
  contracts stabilize.
- F1 may start from fixtures after B9 contracts; F2 waits for F1.

Every task gets an independent reviewer. A task author does not approve their
own task. Integration order remains the dependency order above even when
implementation runs concurrently.

## 14. Suggested commits and final deliverables

Suggested commits:

1. `docs(subagents): define reviewed delivery loop`
2. `feat(contracts): add subagent review and lineage refs`
3. `feat(session): persist subagent result and review facts`
4. `feat(git): reserve and recover subagent apply operations`
5. `feat(host-runtime): add scoped candidate review tools`
6. `feat(host-runtime): add reviewed subagent continuation`
7. `feat(host-runtime): gate candidate apply on exact approval`
8. `feat(host-runtime): persist subagent delivery verification`
9. `feat(orchestration): add reviewed delivery scheme`
10. `feat(agent-host): normalize review loop presentation`
11. `feat(desktop): present subagent review and repair loop`
12. `test(subagents): cover end-to-end reviewed delivery`
13. `docs(subagents): record review loop delivery evidence`

Required final artifacts:

- contracts and public exports;
- durable manifest/operation migrations and recovery;
- seven model-facing capability changes (`start.reviewOf`, richer `wait`,
  result read, review submit, continuation, approved apply, and verification
  submit);
- built-in reviewed-delivery scheme with per-role model configuration;
- Desktop connected-loop projection;
- CLI-compatible structured output;
- focused and end-to-end automated tests;
- updated ADR/spec/architecture notes;
- one reproducible real-model evidence document;
- this plan marked `Complete` with exact base/head commits and any deliberately
  deferred limitations.

Do not call the slice delivered if it only produces reviewer prose, relies on
an in-memory approval flag, applies “latest result” without exact refs, or has
not survived the restart/conflict/manual smoke cases.

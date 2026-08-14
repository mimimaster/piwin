# ADR 0050: Tool Execution Pipeline V2 (Port Authority, Pipeline Lifecycle, Policy/Approval Decoupling)

- **Status**: Accepted
- **Date**: 2026-08-14
- **Scope**: `@piwin/contracts`, `@piwin/host-runtime`, `@piwin/agent-host`
- **Deciders**: Core Architecture Team
- **Consults**: ADR 0019 (Permission Rule Engine), ADR 0024 (Run Modes & Sandbox), ADR 0033 (MCP Supervisor), ADR 0044 (Lazy Host Toolbox)

---

## Context and Problem Statement

piwin's tool execution architecture was anchored on `SessionHostToolExecutionPort` (outer authority boundary) and `HostToolExecutionRouter` + `HostToolAdmissionGate`.

While the authority boundary (`sessionId`, `runtimeGenerationId`, `runId`, `manifest restriction`) was solid, several structural deficiencies emerged as the system evolved:

1. **Invocation Lifecycle Growth**: `HostToolExecutionRouter.execute()` was still small, but the required ordering now includes canonical preparation, post-await authority revalidation, replay admission, deadline handling, and late-settlement ownership. Adding those as independent patches would turn a name router into an implicit state machine without an explicit lifecycle contract.
2. **Policy & Interaction Conflation**: `HostToolAdmissionGate` mixed pure rule evaluation (`evaluateAdmission`, `resolveDomainPolicy`) with async human-in-the-loop approval, project permissions file IO, and session allowlists.
3. **Argument Interpretation Divergence**: Raw model arguments were evaluated by permissions before being parsed and normalized by executors, leading to duplicated normalization (e.g. `resolvePath`) and potential security discrepancies.
4. **Post-Approval Authority Race**: Asynchronous user approval (which can take tens of seconds) did not re-verify whether the Run was cancelled, the Generation was replaced, or Immediate Safety was tightened during the wait.
5. **Lack of Invocation Deduplication**: Repeated tool calls with the same `toolCallId` (e.g., retries/replays) could duplicate irreversible side effects. V2 treats this as a protocol hardening guarantee, not evidence that duplicate frames are already a common production incident.
6. **Dual Router for Toolbox**: `session-host-tool-port.ts` maintained separate `router` and `toolboxRouter` instances.

---

## Decision Drivers

1. **Single Entry & Single Callable Execute**: Every Host-owned tool execution must pass through `SessionHostToolExecutionPort` into one `execute` implementation. That function may later be renamed Pipeline; it must never exist twice.
2. **No Secondary Tool Registries**: Preserve `buildSessionHostTools()` as the sole composition root and `GenerationToolSurface` as the generation-frozen snapshot.
3. **Pure Policy vs. Stateful Approval**: Isolate policy evaluation into pure functions with zero IO, and broker approvals through a dedicated component.
4. **Canonical Argument Normalization**: Prepare and validate arguments before permission evaluation (`Prepare -> Validate -> Safety -> Policy -> Approval -> Revalidate -> Execute`).
5. **Fail-Closed by Default**: Unknown side-effect tools without explicit permission declarations must fail closed.
6. **Execution Replay Protection**: Deduplicate concurrent identical tool calls and replay cached results for settled invocations.
7. **Cross-Backend Parity**: Both SDK and RPC workers execute through the exact same port and pipeline.
8. **Truthful Cancellation and Deadline Semantics**: Returning `aborted` or `timeout` does not claim a non-cooperative executor was killed; once runner execution starts, the invocation key remains sealed and the underlying promise stays owned until late settlement or lifecycle cleanup.
9. **Bounded State Without Weakening At-Most-Once**: Result caching is byte-bounded, while active-Run tombstones are retained until Run terminal and protected by a hard per-Run key ceiling.

---

## Considered Options

- **Option 1: Adopt a Generic Global Tool Registry Framework**.
  - *Rejected*: Violates the generation-scoped Blueprint architecture of piwin. Bypasses session capability filters, project trust boundaries, and snapshot immutability.
- **Option 2: Patch `HostToolExecutionRouter` with a middleware/hook onion**.
  - *Rejected*: an open-ended hook list hides ordering invariants.
- **Option 3: Grow the existing Router in place, then extract (Selected)**.
  - *Not* a second dispatch sitting beside the Router.
  - Phase 1 (required): the current `HostToolExecutionRouter.execute` gains prepare → canonical args → post-await authority/safety revalidation → fail-closed unknown actions.
  - Phase 2: extract `ToolPolicyEvaluator` / `ToolApprovalBroker`; Port still calls the same Router.
  - Phase 3 (optional): attach `ToolInvocationLedger` to that same `execute`. Cancel does not terminalize a Run; `releaseRun` waits for `RunRegistry.onRunTerminal`.
  - Phase 4 (optional): rename Router/`CachedTools` to Pipeline/`GenerationToolSurface` and drop `toolboxRouter`.
- **Option 4: Build Pipeline off-path, then atomically cut over**.
  - *Rejected*: M1 would delete `resolvePath` before production calls `prepareArgs`, and a big-bang switch rewrites the hottest path twice.

---

## Decision Outcome

Adopt **Tool Execution Pipeline V2**, implemented as Option 3 (grow-in-place). The end-state names in the spec are optional; the required decision is the invariants.

1. **`SessionHostToolExecutionPort`** remains the only entry. SDK and RPC already share it.
2. **Required invariants** land on the existing `HostToolExecutionRouter.execute` first: `prepareArgs` + canonical validation, revalidation immediately before `execute`, fail-closed unknown actions. `permissionSpec.action` stays `string`; the catalog is enforced at compose time.
3. **`HostToolAdmissionGate`** may later split into **`ToolPolicyEvaluator`** + **`ToolApprovalBroker`** without changing Port dispatch.
4. **`ToolInvocationLedger`** is optional until duplicate `toolCallId` frames are real. If added: key `(runId, toolCallId)`, fingerprint canonical args with UTF-16-sorted keys, seal after runner start, `releaseRun` only on `RunRegistry.onRunTerminal` (cancel is `cancelling`, not terminal).
5. **`network:video-gen`** becomes an explicit catalog `allow` (`legacy-unclassified-allow`). It must not inherit image-gen's dummy-host web-fetch prompt.
6. **Rename** to `GenerationToolSurface` / `ToolExecutionPipeline` and delete `toolboxRouter` only after the invariants are already in production on the single path.
7. Revalidation does not claim to eliminate filesystem symlink/rename TOCTOU. No ignored sandbox/remote `executor` field.

---

## Consequences

### Positive
- **Argument determinism**: Permission evaluation and execution consume the same canonical arguments; Host authority and live safety are revalidated immediately before runner admission.
- **Robustness**: Long human approval pauses can no longer cause stale execution on cancelled runs or superseded generations.
- **Testability**: Pure policy evaluators can be tested exhaustively without mocking IO or UI loops.
- **Safety**: Side-effect tools without explicit declarations fail closed.
- **Cleaner policy tests** (after Phase 2): the evaluator can be exhausted without mocking IO. Deleting the Router name is optional.

### Negative / Trade-offs
- Requires migrating side-effect tool registrations to define `prepareArgs`.
- Adds a real invocation state machine whose abort/deadline/late-settlement behavior requires concurrency tests.
- Active Runs retain compact invocation tombstones until terminal. Memory is bounded by a hard per-Run key ceiling; replay results additionally use count and byte budgets.
- Timeout is a caller deadline plus cooperative abort, not a guarantee that an in-process executor was killed.

---

## Links and References
- Full Specification: [`docs/specs/tool-execution-pipeline-v2.md`](../specs/tool-execution-pipeline-v2.md)
- Implementation Plan: [`docs/plans/2026-08-14-tool-execution-pipeline-v2.md`](../plans/2026-08-14-tool-execution-pipeline-v2.md)
- Architecture Invariants: [`AGENTS.md`](../../AGENTS.md)

### Spec revision (same day)

Normative details live in the spec. A third pass changed *how* V2 is adopted, not the invariants:

- Implement by growing `HostToolExecutionRouter.execute`. Off-path Pipeline + atomic cutover is rejected (it races `prepareArgs` against leftover `resolvePath`).
- Ledger and the Pipeline/Surface rename are optional later stages.
- `releaseRun` cannot hook cancel: `RunRegistry.cancelRun` only moves to `cancelling` and aborts.
- Fingerprint key order is explicit UTF-16 code-unit sort, not `Object.keys` enumeration order.
- `video-gen` stays an explicit allow, not a silent product change onto image-gen rules.

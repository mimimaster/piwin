# Inline subagent conversation blocks and lifecycle repair

Status: Implemented (automated verification complete; manual Desktop smoke pending)
Date: 2026-08-12
Scope: session scope creation, subagent orchestration lifecycle, transcript projection, Desktop inline UI, child-session inspector/follow-up
Supersedes for UI behavior: the read-only/dock-first parts of `docs/superpowers/plans/2026-08-03-subagent-activity-inspector.md`

Implementation note (2026-08-12): phases 1–6 landed as one vertical slice.
The Host now persists revisioned invocation projections, terminalizes stale
children after restart, and supports same-child continuation plus explicit
worktree apply/retain/discard. Desktop renders delegation at the parent tool
call, uses shared transcript/tool/permission/file surfaces in the child
window, and no longer ships the composer-adjacent Working dock. Historical
mis-scoped sessions use a non-destructive **Continue in project…** copy;
their source records remain unchanged and auditable.

## 1. Outcome

Make subagents a first-class part of the parent assistant response:

1. When the model starts `piwin_subagent_run`, an inline subagent block appears at that exact position in the assistant response immediately.
2. Each block has a stable title/status line and a second line that continuously reflects the child's latest meaningful activity.
3. Clicking the block opens a child-session window that uses the same transcript, reasoning-summary, tool-call, permission, attachment, error, and streaming presentation as the main conversation.
4. Child sessions always reach a durable terminal state. A failure before model execution must still close the child shell and update the parent block.
5. A session created from a project's `+` entry point is project-scoped from its first Host request; it cannot briefly inherit General scope from asynchronous navigation state.
6. The existing input-adjacent `SubagentWorkingDock` is removed as the primary representation. Current-response subagents live in the transcript. A future background-work notification may be retained only for work that is not visible in the currently opened transcript.

This plan intentionally treats the two reported failures and the requested UI as one vertical slice. The UI cannot be trustworthy until scope, identity, persistence, and terminal-state ownership are corrected.

## 2. User-visible interaction contract

### 2.1 Parent response

The visible order is causal and stable:

```text
assistant prose before delegation

[subagent block A: title · role/model/profile]
[latest activity A]

[subagent block B: title · role/model/profile]
[latest activity B]

assistant prose or tool work after delegation
```

The block is created by the `tool/start` position, not appended to a global activity area. Parallel subagents remain separate blocks in the order their calls were emitted.

The block states are:

```text
starting -> queued -> running -> completed
                            \-> failed
                            \-> cancelled
                            \-> needs-integration
```

Presentation rules:

- `starting`: the model has emitted a delegation call but Host admission/child allocation is not complete.
- `queued`: accepted but waiting for an execution slot.
- `running`: child execution owns the task.
- `completed`: child response and required summary finished.
- `needs-integration`: execution finished but worktree output still needs an explicit product action.
- `failed` and `cancelled` are terminal and must include a concise safe reason.
- The second line shows one latest semantic activity, such as `Thinking`, `Reading architecture.md`, `Running tests`, `Waiting for permission`, or `Finished in 41s`.
- Raw private chain-of-thought is never surfaced. Only already-normalized reasoning summaries, public assistant text, and Host tool presentations may be used.
- Token deltas do not cause layout growth. The second line replaces its previous value in place and is visually clipped to one line.
- Reduced-motion settings disable rolling/fading transitions without changing content.

### 2.2 Child-session window

Clicking any inline block opens a bounded modal/sheet with:

- fixed header: title, status, duration, role/profile/model, expand/open-full-session, close;
- task brief as the first user message or a compact pinned task card;
- the normal session transcript renderer, including causal assistant text/tool order;
- live auto-follow with the same “back to latest” behavior as the main transcript;
- history/live deduplication by generation, run, message, event sequence, and tool-call identity;
- reconnect/reopen support from durable transcript plus replayed live tail;
- terminal error/cancellation and retained-worktree actions;
- a constrained child composer using the same child identity and captured runtime ceiling.

The child window is not a second simplified transcript implementation. The main transcript renderer is extracted into reusable primitives and configured for a child session.

### 2.3 Child composer semantics

The reference UI includes follow-up input, so the target includes it, but it must not be a cosmetic enabled textbox before Host ownership is defined.

- While the orchestrator-owned child run is active, follow-up is disabled in the first release. The UI explains that the current task is still running.
- After a readonly child is terminal, a follow-up starts a new Run in the same child session and preserves its immutable runtime/profile ceiling.
- After a worktree child is terminal, follow-up is allowed only while the retained worktree lease still exists and is valid.
- After a worktree has been integrated or removed, the UI requires an explicit new isolated continuation; it must never silently execute in the parent checkout.
- A follow-up does not reopen or mutate the already-terminal original batch. It creates a new descendant Run with its own terminal outcome.
- Applying child changes remains an explicit integration action and is not implied by sending a follow-up.

## 3. Confirmed current failures

### 3.1 Project `+` can create a General session

The original Desktop project-row action called project navigation and new-session creation back-to-back. Project navigation is asynchronous, so the draft/session path could capture the previous General scope.

The current dirty worktree already contains the correct direction:

- `ProjectSessionSidebar` passes `{ scope: projectScope }` directly to `onNewSession`.
- `use-composer-media` keeps a draft-owned scope independent of asynchronous active-project navigation.
- A sidebar test asserts the clicked project scope is passed explicitly.

These changes are not treated as complete until the first Host `session/create` request and persisted index/transcript scope are covered by an integration test.

### 3.2 General parent is converted into an invalid project child

`HostRuntime.prepareSubagentTask` currently reads `sessionProjects`, where General sessions are represented by an empty string, and then always creates:

```ts
scope: { kind: 'project', projectPath: parentProjectPath }
```

Nullish fallback does not replace `''`, so the child fails validation with `project scope requires a non-empty projectPath`.

Required behavior:

- project parent -> project child with the same canonical project scope;
- General parent + readonly child -> General child using the General workspace;
- General parent + worktree child -> reject during admission, before allocating a child shell, because there is no project Git authority;
- a project child may use a worktree `cwd`, but its product scope remains the parent project, not the temporary worktree path.

### 3.3 Pre-run failures leave child sessions running forever

The orchestrator allocates and persists a child shell before task preparation. Its catch path builds a failed `SubagentTaskResult` without the already allocated `childSessionId`. `persistSubagentTaskResult` returns early when that optional field is absent, leaving the session index at `running` even though the durable run manifest is terminal.

The four reported tasks therefore did not perform model work. They failed during preparation/allocation, while their persisted child shells stayed in the active projection.

Required invariant:

> Once a child session record exists, every terminal task result contains its `childSessionId`, and terminal persistence is executed exactly once even if preparation, worker startup, execution, summary, integration, cancellation, push delivery, or shutdown fails.

## 4. Architecture decisions

### 4.1 Stable invocation identity

One inline block represents one parent delegation invocation. Introduce a stable `SubagentInvocationId` and persist this linkage:

```text
parentSessionId
parentRuntimeGenerationId
parentRunId
parentResponseMessageId
parentToolCallId
invocationId
batchRunId
taskId
childSessionId (late-bound)
```

For a model-facing tool call, `invocationId` is generated at Host admission and is associated with the parent `toolCallId`; clients must not derive it from task text, display name, or array position.

`HostToolExecutionContext` must add optional `toolCallId` and `responseMessageId`, populated by the Host tool bridge from the normalized parent tool event. If a backend cannot prove `responseMessageId`, the recorder's causal tool-call association is used; the Host must never guess from “latest message” once more than one response is active.

Plan-driven orchestration without a model tool call receives an explicit Host-owned transcript anchor linked to its plan step. It must not invent a fake Pi `AgentEvent`.

### 4.2 Two-channel projection

Use two complementary channels:

1. `subagent/invocation-updated`: low-frequency latest-wins control projection for identity, state, title, child binding, timestamps, safe latest activity, and error/integration facts.
2. Existing `subagent/stream`: ordered append stream of normalized child `AgentEvent` values for the full child transcript.

The control projection is persisted. The high-rate stream remains replayable event data and is not copied token-by-token into the parent transcript.

### 4.3 Parent transcript is the visual anchor

Extend the Host-normalized tool presentation with a typed subagent invocation summary and add `subagent` to `ToolKind`. The specialized Desktop renderer replaces the generic `piwin_subagent_run` tool card at the same `responseMessageId/toolCallId` location.

Do not use `SessionTranscriptMessage.subagentActivity` system rows for new calls. That older mechanism has no reliable parent tool-call ownership and is not currently populated by the production model-facing path.

On hydrate:

- persisted parent tool card restores the immediate anchor;
- persisted invocation/child linkage restores the latest known state;
- active run projection and child replay restore live state;
- terminal state in the durable run manifest wins over a stale session summary.

### 4.4 Host owns lifecycle truth

Desktop never decides whether a child is running by observing whether text is still streaming. It projects the latest authoritative Host lifecycle revision.

Every invocation update includes a monotonic `revision` or comparable version. Reducers reject older revisions. Lifecycle and content remain separate: a message can stop streaming while the task is summarizing or integrating, and the task can be terminal even if a final UI event was missed.

### 4.5 Shared transcript renderer

Extract reusable components from `ChatThread`/turn rendering:

- session transcript viewport;
- assistant response segment renderer;
- reasoning-summary block;
- `TurnWorkDetails`/tool groups/`ToolCallCard`;
- permission and waiting states;
- attachment/artifact rendering;
- follow-latest controller.

The main and child surfaces use the same projection and components with capability flags. Remove `SubagentToolRow` and the child-only simplified thinking/tool renderer after parity tests pass.

### 4.6 Egress and recovery policy

- Invocation lifecycle updates are latest-wins projections and must be present in hydration/recovery.
- Child agent events remain ordered append data under existing replay/sequence rules.
- Safe latest-activity projection is coalesced on semantic transitions or a short bounded interval; raw token frequency must not flood Host push or React state.
- If a gap is detected, the child window fetches a bounded transcript page and resumes after its latest cursor.
- Opening a child window must not require a live worker. Cold terminal sessions remain inspectable.

## 5. Contract changes

Add in `packages/contracts` before implementers:

```ts
type SubagentInvocationStatus =
  | 'starting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'needs-integration';

type SubagentLatestActivity = {
  kind: 'starting' | 'queued' | 'thinking' | 'tool' | 'text' | 'waiting' | 'terminal';
  label: string;
  at: string;
  behaviorId?: string;
  toolCallId?: string;
  messageId?: string;
};

type SubagentInvocationProjection = {
  invocationId: string;
  revision: number;
  parentSessionId: string;
  parentRuntimeGenerationId: string;
  parentRunId: string;
  parentResponseMessageId?: string;
  parentToolCallId?: string;
  batchRunId?: string;
  taskId: string;
  childSessionId?: string;
  displayName: string;
  taskSummary: string;
  status: SubagentInvocationStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  role?: string;
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  isolation: SubagentIsolationMode;
  latestActivity?: SubagentLatestActivity;
  error?: string;
  worktreePath?: string;
};
```

Exact optionality must follow `exactOptionalPropertyTypes`; do not emit explicit `undefined` fields.

Additional changes:

- add `subagent/invocation-updated` to `HostPushVariant`;
- add a hydration/status command for invocation projections by parent session, or include them in the existing parent resume payload if bounded;
- make `childSessionId` required on `SubagentTaskResult` after allocation; represent admission failure before allocation as a distinct invocation failure, not as a child task result;
- persist invocation identity in the child session record and run manifest;
- add `toolCallId`/`responseMessageId` to `HostToolExecutionContext` when proven;
- extend `ToolPresentation` with a typed subagent summary rather than passing untyped tool arguments to Desktop;
- classify the new push in egress delivery/replay policy and update IPC/mock implementations.

## 6. Host lifecycle repair

### 6.1 Scope-safe creation

Create a single Host helper that derives child creation input from the durable parent session record, not the lossy `sessionProjects` string map:

```text
parent project + readonly/worktree -> child project scope; lease controls cwd
parent General + readonly          -> child General scope; General workspace cwd
parent General + worktree          -> admission error before child allocation
missing parent record              -> fail before child allocation
```

Do not infer project scope from arbitrary `cwd`.

### 6.2 Allocate identity before side effects

Recommended order:

1. validate request, role/profile/model, parent scope, and isolation;
2. create invocation identity and persist `starting`;
3. acquire resource/workspace lease;
4. allocate `childSessionId` and child task Run;
5. persist child session start with invocation linkage;
6. prepare immutable child blueprint;
7. start worker and stream events;
8. summarize/integrate;
9. write one terminal result and one terminal invocation projection;
10. release runtime resources; retain/remove worktree according to real lease state.

Validation errors before step 4 fail the inline invocation without creating a phantom child session.

### 6.3 Terminalization in one owner

Refactor task execution so success, error, cancellation, and late-return paths converge on one `finalizeTask` routine. It receives the allocated identities and lease explicitly and is idempotent.

The error path must include `childSessionId` whenever allocation happened. Failure to deliver a push must not prevent index/run-manifest persistence. Persistence failure is logged and retried/reconciled; it is not silently swallowed.

### 6.4 Startup reconciliation

At Host startup and on parent hydration:

- inspect active-looking child session records;
- compare them with durable task/run manifests and worker ownership;
- project terminal manifest state onto stale child records;
- mark an orphan with no active worker and no resumable run as failed/interrupted with a diagnostic reason;
- never mark an active child terminal solely because Desktop disconnected.

This repairs old “running forever” shells, including the reported four, without requiring their workers to exist.

### 6.5 Existing mis-scoped parent sessions

Do not silently reclassify all General sessions based on their titles or historic `cwd`; legitimate General sessions exist.

For the reported parent session, offer an explicit Host-owned repair operation or migration script that:

- validates the selected project path;
- atomically updates session index and transcript scope/working-directory metadata;
- leaves historical usage records auditable rather than rewriting them silently;
- reports child lineage affected by the move;
- then rehydrates Desktop under the project tree.

If that operation is not implemented in the first slice, the safe product fallback is “Continue in project” to a new project-scoped session. New creation must still be fixed immediately.

## 7. Desktop data model and rendering

### 7.1 Reducer state

Replace dock-oriented inference with normalized maps:

```text
subagentInvocationsById
invocationIdByParentToolCall
childSessionIdByInvocationId
childTranscriptStateBySessionId
```

Apply invocation updates by revision. Apply child stream events using the same causal session event reducer as a main session, parameterized by session id. Do not retain only one flat `text/thinking/tools` tail; a child can produce multiple assistant messages and interleaved tool calls.

### 7.2 Inline component

Add `SubagentInvocationBlock` next to the specialized tool renderers:

- key: `invocationId`, with parent tool-call fallback only during `starting`;
- line 1: title + optional role/profile/model/thinking badges + terminal status;
- line 2: latest safe activity;
- running visual treatment uses existing behavior animation registry;
- completed/failed state remains in transcript and never disappears;
- click opens the child window when a child exists; pre-allocation failures open inline details instead;
- keyboard activation, focus ring, screen-reader status announcements, and reduced motion are required.

### 7.3 Dialog

Refactor `SubagentSessionDialog` to host the shared `SessionTranscriptView`.

- Keep the stale-response guard when switching children.
- Load bounded history first, then replay/live events after the returned cursor.
- Do not render the same current message both from persisted history and live state.
- Preserve scroll position when older pages are loaded.
- “Open full session” remains available but is secondary; the modal itself is fully useful.

### 7.4 Dock migration

Phase out:

- `SubagentWorkingDock` above the composer for current-response work;
- `SubagentActivityTicker` as the only source of current activity;
- `SubagentActivityCard` system-message ownership for new runs;
- child-only `SubagentStreamState`/`SubagentStreamTool` once shared projection lands.

During one compatibility release, the dock may show only active subagents whose owning parent response is not currently visible, such as another session's background work. It must not duplicate blocks already rendered in the active transcript.

## 8. Implementation sequence

### 8.1 Phase 0 — ADR and executable fixtures

- Add an ADR for parent-transcript subagent invocation identity, two-channel projection, child follow-up ownership, and recovery truth.
- Capture the reported project-scope and four pre-run failures as fixtures.
- Add a deterministic fake child worker that emits multiple messages, thinking summaries, tools, permission waits, completion, failure, and cancellation.

Exit gate: the failure is reproducible in tests and architectural ownership is approved.

### 8.2 Phase 1 — scope and terminal-state hotfix

- Land/verify explicit project scope capture from the project `+` path.
- Replace empty-string project-map derivation with durable parent `SessionScope` derivation.
- Reject General/worktree before child allocation; support General/readonly correctly.
- Preserve allocated child identity in every post-allocation failure result.
- Centralize idempotent task finalization.
- Add startup stale-child reconciliation.

Exit gate: no test path leaves a persisted child at `running` after terminal batch state.

### 8.3 Phase 2 — invocation contracts and Host correlation

- Add the contract types/push/hydration path.
- Propagate parent tool-call/response identity into Host tool execution context.
- Persist invocation records and child linkage.
- Emit `starting` before slow workspace/worker work, then revisioned state updates.
- Project semantic latest activity from normalized child events.

Exit gate: two parallel delegation calls in one assistant response remain independently addressable across restart/reconnect.

### 8.4 Phase 3 — inline parent blocks

- Classify `piwin_subagent_run` as a specialized subagent tool presentation.
- Render `SubagentInvocationBlock` at the generic tool call's causal position.
- Bind live invocation and latest-activity updates.
- Keep terminal blocks durable.
- Stop showing current-response children in the composer dock.

Exit gate: the requested Cursor-like parent interaction works with queued, running, completed, failed, and cancelled states.

### 8.5 Phase 4 — shared child transcript window

- Extract shared transcript/turn/tool renderer primitives.
- Replace the simplified subagent transcript and tool rows.
- Implement bounded history + replay + live deduplication.
- Add parity for permission, tool errors/output expansion, files, attachments, artifacts, thinking-summary visibility, and back-to-latest.

Exit gate: the same normalized child event fixture renders equivalent call-chain semantics in the main view and child modal.

### 8.6 Phase 5 — child follow-up composer

- Add Host command/contracts for child continuation Run admission.
- Enforce readonly/worktree lease rules from section 2.3.
- Add model/thinking controls only within the child's captured ceiling.
- Stream the new Run into the same child window and keep original batch terminal.
- Add explicit apply/retain/discard actions for valid worktree output.

Exit gate: follow-up cannot escape scope/isolation and survives modal close/reopen.

### 8.7 Phase 6 — cleanup and historical repair UX

- Remove obsolete dock-first/current-tail-only code and tests.
- Add explicit “move/continue in project” handling for known mis-scoped sessions.
- Run startup reconciliation on historical stale child records.
- Update PRD, architecture, Desktop behavior spec, and user guide.

## 9. Test matrix

### 9.1 Scope

- project `+` clicked while General is active -> first create request is project-scoped;
- rapid project A/project B/new-agent actions preserve the clicked scope;
- draft resumed after navigation preserves its original scope;
- project parent -> readonly and worktree child scopes are project;
- General parent -> readonly child is General;
- General parent -> worktree fails before child allocation with actionable UI.

### 9.2 Lifecycle

- workspace acquisition failure before child allocation -> failed invocation, no child shell;
- failure after child allocation but before worker -> child terminal failed;
- worker startup failure, provider failure, summary failure, integration failure;
- cancellation while queued, preparing, streaming, summarizing, integrating;
- late worker return after cancellation cannot revive state;
- Host shutdown/restart reconciliation;
- duplicate/out-of-order terminal push is idempotent;
- terminal manifest overrides stale `SessionSummary.subagentStatus`.

### 9.3 Correlation and replay

- two parallel calls with identical task text do not collide;
- child binds to the correct parent response/tool call;
- out-of-order invocation revisions are ignored;
- replayed child events dedupe by envelope/generation/message/tool identity;
- parent hydrate restores inline blocks before live replay arrives;
- background parent updates do not contaminate the active transcript.

### 9.4 UI

- block appears on `tool/start` before child output;
- latest activity replaces in place and does not move the composer;
- terminal block remains clickable;
- click/Enter/Space opens the correct child;
- modal switches rapidly between children without stale transcript bleed;
- main/child tool cards have parity;
- scrolling pauses auto-follow when the user reads older content;
- reduced motion and screen-reader status behavior;
- no duplicate dock item for a visible inline block.

### 9.5 Follow-up

- active child composer disabled;
- readonly terminal follow-up starts a new Run in same child;
- retained valid worktree follow-up keeps the worktree cwd;
- integrated/removed worktree requires explicit new isolation;
- follow-up completion does not mutate the original batch result.

## 10. Verification commands and product smoke

Focused verification during each phase:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/session test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/desktop test
```

Final verification:

```bash
pnpm typecheck
pnpm test
pnpm test:architecture
git diff --check
```

Manual/automated Desktop smoke:

1. Open General, click `+` on `piwin`, send a delegation prompt, and verify the parent persists under `piwin`.
2. Start two readonly children; confirm two inline blocks appear in causal order and update independently.
3. Open each block while running; confirm live message/tool call chains stream without duplication.
4. Force a pre-worker failure; confirm the block and child session both become failed immediately.
5. Cancel a running child; confirm no later event revives it.
6. Restart Host/Desktop mid-run; confirm hydration/replay restores blocks and correct status.
7. Complete a worktree child; confirm retained/integration state and follow-up restrictions.

## 11. Acceptance criteria

- The reported project-row creation path cannot persist a General session.
- The reported empty-project-path failure cannot create a stuck running child.
- No terminal run manifest has an active-looking child session after reconciliation.
- A subagent block is visible inside the owning assistant response from tool start through terminal state.
- Parallel calls map one-to-one to their child sessions across reconnect/restart.
- The block's latest activity is live, bounded, safe, and semantically derived.
- Clicking opens a full-fidelity streaming child conversation using shared rendering code.
- Current-response subagents are not duplicated in a composer-adjacent dock.
- Follow-up, when enabled, preserves session scope, runtime ceiling, and worktree ownership.
- Contracts, host, session, Desktop, architecture tests, and `git diff --check` pass.

## 12. Non-goals

- Nested subagents beyond the current depth ceiling.
- Exposing raw provider/Pi-native events to Desktop.
- Exposing private hidden chain-of-thought.
- Treating Gateway as session, run, tool, or subagent authority.
- Automatically applying worktree changes because a child completed.
- Silently guessing and rewriting the scope of every historic General session.
- Keeping a second child-only tool/transcript rendering system after parity migration.

# Plan Artifact Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/write-plan` 生成的长任务计划变成对话内可审批、可 Process 的计划卡，并支持 `subagent-driven` 与 `inline` 两种真实执行路径。

**Architecture:** 计划仍是 application-layer `SessionPlan`，不把 Antigravity 或 Pi 私有格式引入产品。模型通过 piwin host 提供的结构化 plan artifact 能力写入 draft 计划；Desktop 只渲染 artifact 并发出 typed host command。用户点击 Process 后由 host 将计划批准并启动统一的执行编排：inline 在当前会话按计划执行，subagent-driven 为每个独立步骤创建受约束的子会话、收集结果并在父会话合并；两者都通过现有 normalized events、计划状态和子代理生命周期回传 UI。

**Tech Stack:** TypeScript strict, `@piwin/contracts`, `@piwin/agent-host`, `@piwin/session`, bundled `SKILL.md`, React/Vitest Desktop UI.

## Global Constraints

- UI/apps never import `@earendil-works/pi-*`; only `packages/agent-host` may import Pi.
- New cross-cutting behavior starts in `packages/contracts`; no circular package dependencies.
- Both SDK and RPC host modes expose the same plan execution contract; adapters remain behind `AgentHost`/`HostRuntime`.
- `/write-plan` is an alias of the existing bundled `writing-plans` skill; the canonical skill id stays `writing-plans` and `/write-plan` resolves to it via slash parsing. No duplicate `write-plan` skill is created.
- Model output and plan text are untrusted; validate plan shape, cap text/step counts, and never execute arbitrary fields from a plan.
- Long operations have abort behavior; no floating promises; strict TypeScript and no `any`.
- Required verification is `pnpm typecheck`, touched-package tests, and a Desktop manual smoke path.

---

## Research Findings and Product Decisions

### Antigravity behavior to reproduce

Public Google Antigravity codelabs describe a review-driven artifact lifecycle:

1. The agent produces an **Implementation Plan** before modifying source files.
2. The plan is visible in the conversation/artifact surface and has a **Proceed** approval gate.
3. Once approved, the agent creates/updates a concrete **Task Plan** while executing.
4. After implementation and verification it produces a **Walkthrough** summarizing changes, stack, validation, and how to test.
5. Text artifacts can be reviewed/commented before execution; piwin should first ship the approval gate and typed execution modes, while comments and rich artifact pane can remain a later slice.

### Existing piwin capability and gap

- `packages/contracts/src/plan.ts` already defines `SessionPlan`, draft/approved/executing/done statuses, and step statuses.
- `packages/session` validates and persists `plan.json`; `packages/agent-host` injects approved plans into model context and exposes `piwin_plan_set_step` in SDK mode.
- `apps/desktop/src/plan-card.tsx` currently renders a session-level checklist only; it has no approval or execution callback.
- `PlanPanel` can manually create/approve plans, but the bundled `writing-plans` skill only emits generic Markdown guidance and no plan execution command exists.
- Subagent sessions already support spawn/cancel/complete/merge and optional worktree isolation, but there is no plan-to-subagent orchestration.

### Decisions

- The conversation card is the primary approval surface; the right-side PlanPanel remains an editor/inspector and is not duplicated.
- A plan produced by `/write-plan` (or `/writing-plans`) carries `source: 'skill'` plus `skillId: 'writing-plans'` and execution metadata. User-created plans remain supported.
- A plan is **long/complex** when the structured artifact says it has at least 4 steps, or at least 2 steps with explicit independent work units. The classifier is pure and tested; it is not inferred from arbitrary prose in the UI.
- A long plan produced via `/write-plan` (alias of `writing-plans`) must expose `subagent-driven`; `inline` remains available as an explicit fallback only when the user chooses it. Short plans expose both modes, with inline as the default.
- `subagent-driven` means one child session per eligible independent step, using readonly/worktree policy from the plan, followed by parent merge/verification. It must not silently mutate the parent from the UI.
- `inline` means the parent session receives a host-generated execution directive containing the validated plan and updates the same plan steps through the existing tool/event path.
- Process is idempotent: draft → approved → executing is guarded by host state; repeated clicks cannot launch duplicate runs.
- Walkthrough is initially a final assistant/system artifact message or structured completion payload summarizing changed files, verification, and unresolved items; a rich standalone artifact pane is a later enhancement.

---

## File Map

- Create `packages/contracts/src/plan-execution.ts`: execution mode, plan execution request/status/result contracts.
- Modify `packages/contracts/src/plan.ts`: provenance and execution metadata on validated plans.
- Modify `packages/contracts/src/ipc.ts`: typed `plan/execute`, `plan/abort`, and execution push messages.
- Modify `packages/contracts/src/index.ts`: intentional public exports.
- Modify `packages/session/src/validate-plan.ts`: validate new optional metadata and bounded values.
- Create `packages/session/src/classify-plan.ts` and test: pure long/complex classification.
- Modify `packages/session/src/index.ts`: export classifier/types.
- Create/modify `packages/agent-host/src/plan-execution.ts`: host-owned inline/subagent orchestration and idempotency.
- Modify `packages/agent-host/src/commands/plan-commands.ts` and `host-runtime.ts`: route execution/abort and push normalized plan execution updates.
- Create `packages/agent-host/src/plan-execution.test.ts`: mock-host orchestration tests.
- Create `packages/agent-host/src/plan-create-tool.ts`: model-facing structured draft-plan tool.
- Modify `packages/agent-host/src/sdk-adapter.ts` and any shared tool registration path: register the create tool in SDK; provide equivalent RPC request path through contracts.
- Modify `skills/writing-plans/SKILL.md`: extend the existing bundled skill with the piwin plan artifact protocol (no new `write-plan` skill — keep one canonical planning skill).
- Modify `apps/desktop/src/slash/slash-parse.ts` and `slash-catalog.ts`: add `/write-plan` as an alias of `writing-plans`.
- Extend `packages/skills/src/skill-scanner.test.ts` and `apps/desktop/src/slash/slash-parse.test.ts`: assert bundled discovery, required protocol instructions, and alias resolution.
- Modify `apps/desktop/src/plan-card.tsx`: approval copy, Process button, mode buttons, status/error/disabled states.
- Modify `apps/desktop/src/chat-thread.tsx`: pass plan execution callback and render card in the assistant conversation surface.
- Modify `apps/desktop/src/App.tsx` and `host-request-adapters.ts`: call typed plan commands, update local feedback, preserve session identity.
- Modify `apps/desktop/src/styles/region-transcript.css`: card/button styling matching the supplied reference.
- Modify `apps/desktop/src/plan-card.test.ts`, add `apps/desktop/src/plan-card.test.tsx` if needed: rendering and callback behavior.
- Modify `apps/desktop/src/host-client-mock.ts`: deterministic plan execution mock responses/pushes.
- Add/update `docs/adr/` only if execution isolation or subagent merge semantics differ from the existing ADR; otherwise update `docs/dev-plan.md` and this feature plan status.

---

### Task 1: Add the contract for plan execution and plan provenance

**Files:**
- Create: `packages/contracts/src/plan-execution.ts`
- Modify: `packages/contracts/src/plan.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts` existing typecheck surface

**Interfaces:**

```ts
export type PlanExecutionMode = 'inline' | 'subagent-driven';
export type PlanExecutionStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'aborted';

export type PlanExecutionRequest = {
  sessionId: string;
  planId: string;
  mode: PlanExecutionMode;
};

export type PlanExecutionState = {
  sessionId: string;
  planId: string;
  mode: PlanExecutionMode;
  status: PlanExecutionStatus;
  currentStepId?: string;
  childSessionIds: string[];
  error?: string;
  startedAt?: string;
  endedAt?: string;
};
```

Extend `SessionPlan` with optional validated metadata:

```ts
skillId?: string;
complexity?: 'short' | 'long';
independentSteps?: string[];
execution?: PlanExecutionState;
```

Add these `HostCommand` variants:

```ts
| { id?: string; type: 'plan/execute'; request: PlanExecutionRequest }
| { id?: string; type: 'plan/abort'; sessionId: string; planId: string }
```

Add push message:

```ts
| { type: 'plan/execution-updated'; state: PlanExecutionState }
```

- [ ] Write the type-level usage fixture in the relevant contracts test or compile-only test, covering both execution modes and optional metadata.
- [ ] Run `pnpm --filter @piwin/contracts typecheck` and verify it fails only until exports and IPC unions are complete.
- [ ] Implement the contracts and intentional exports without adding runtime dependencies.
- [ ] Run `pnpm --filter @piwin/contracts typecheck`; expected: PASS.

### Task 2: Validate and classify long/complex plans

**Files:**
- Create: `packages/session/src/classify-plan.ts`
- Create: `packages/session/src/classify-plan.test.ts`
- Modify: `packages/session/src/validate-plan.ts`
- Modify: `packages/session/src/index.ts`

**Interfaces:**

```ts
export type PlanComplexity = 'short' | 'long';
export function classifyPlanComplexity(plan: SessionPlan): PlanComplexity;
```

Rules:

- `long` if `steps.length >= 4`.
- `long` if `steps.length >= 2` and `independentSteps` contains at least 2 valid step IDs.
- Otherwise `short`.
- Reject duplicate step IDs, unknown independent step IDs, more than 32 steps, and metadata strings over the existing plan byte cap.
- Existing manually-authored plans remain valid without new metadata; derive complexity on read when absent.

- [ ] Write tests for 3-step short, 4-step long, independent 2-step long, unknown independent ID rejection, and duplicate IDs rejection.
- [ ] Run `pnpm --filter @piwin/session test -- classify-plan`; expected: FAIL before implementation.
- [ ] Implement pure classification and validator changes.
- [ ] Run the targeted session tests; expected: PASS.
- [ ] Run `pnpm --filter @piwin/session typecheck`; expected: PASS.

### Task 3: Extend the bundled `writing-plans` skill and add `/write-plan` alias

**Files:**
- Modify: `skills/writing-plans/SKILL.md`
- Modify: `apps/desktop/src/slash/slash-parse.ts`
- Modify: `apps/desktop/src/slash/slash-catalog.ts`
- Modify: `packages/skills/src/skill-scanner.test.ts`
- Modify: `apps/desktop/src/slash/slash-parse.test.ts`

**Skill behavior:**

The existing `writing-plans` skill stays the canonical planning skill (id `writing-plans`). Extend its body with the piwin plan artifact protocol so the model:

- researches the repository before proposing changes;
- does not modify source files before approval;
- creates a structured `SessionPlan` through the piwin plan-create capability with title, goal, ordered steps (stable ids, acceptance/verification detail, no shell commands as fields), `source: 'skill'`, `skillId: 'writing-plans'`, and `independentSteps` only when work can safely be isolated;
- classifies the plan as short or long and states that long plans support `subagent-driven` while `inline` is a user-selected fallback;
- produces a concise chat summary after the tool call so the UI can render the artifact;
- ends execution with a bounded walkthrough summary.

Add `/write-plan` as a slash alias of `writing-plans` so both `/writing-plans` and `/write-plan` resolve to the same skill id. Do not create a second skill asset.

- [ ] Add scanner test asserting the bundled `writing-plans` SKILL.md contains the plan-create tool name, approval gate, and both execution modes.
- [ ] Add slash-parse tests asserting `/write-plan` and `/writing-plans` both resolve to `skillId: 'writing-plans'`.
- [ ] Run targeted tests; expected: FAIL before edits.
- [ ] Extend `skills/writing-plans/SKILL.md` following existing frontmatter/style.
- [ ] Add the alias mapping in slash-parse / slash-catalog without breaking existing skill lookup.
- [ ] Run `pnpm --filter @piwin/skills test` and `pnpm --filter @piwin/desktop test -- slash-parse`; expected: PASS.

### Task 4: Add structured plan creation at the host boundary

**Files:**
- Create: `packages/agent-host/src/plan-create-tool.ts`
- Create: `packages/agent-host/src/plan-create-tool.test.ts`
- Modify: `packages/agent-host/src/sdk-adapter.ts`
- Modify: `packages/agent-host/src/pi-tool-adapter.ts` or the shared tool registration module
- Modify: `packages/agent-host/src/commands/plan-commands.ts`

**Interfaces:**

```ts
export type PlanCreateToolOptions = {
  sessionId: string;
  projectPath: string;
  planPath: string;
  onUpdated?: (plan: SessionPlan) => void;
};

export function createPlanCreateTool(options: PlanCreateToolOptions): HostToolDefinition;
```

The tool validates all model-provided fields, creates only `draft` plans, derives/validates complexity, persists using `saveSessionPlan`, and emits `plan/updated`. It must reject creation while an existing plan is executing and must not accept arbitrary execution commands, paths, or tool definitions.

For RPC mode, expose equivalent host command behavior rather than relying on a custom SDK tool; do not claim custom-tool parity where stock RPC cannot provide it.

- [ ] Write tests for valid draft creation, invalid empty steps, duplicate IDs, oversized metadata, and refusing replacement of executing plan.
- [ ] Run targeted host tests; expected: FAIL before implementation.
- [ ] Implement validation, persistence, event push, and SDK registration.
- [ ] Run `pnpm --filter @piwin/agent-host test -- plan-create-tool`; expected: PASS.
- [ ] Run `pnpm --filter @piwin/agent-host typecheck`; expected: PASS.

### Task 5: Implement host-owned inline and subagent-driven execution

**Files:**
- Create: `packages/agent-host/src/plan-execution.ts`
- Create: `packages/agent-host/src/plan-execution.test.ts`
- Modify: `packages/agent-host/src/commands/plan-commands.ts`
- Modify: `packages/agent-host/src/host-runtime.ts` and/or its command context
- Modify: `packages/agent-host/src/commands/session-live-commands.ts` only where prompt/abort hooks are needed

**Interfaces:**

```ts
export type PlanExecutionCoordinator = {
  execute(request: PlanExecutionRequest): Promise<PlanExecutionState>;
  abort(sessionId: string, planId: string): Promise<void>;
};
```

Execution rules:

- Check session, project, plan ID, plan status, and active execution atomically enough to reject duplicate starts.
- On execute, transition plan to `approved` if draft, then `executing`; emit `plan/updated` and `plan/execution-updated`.
- Inline sends a generated execution directive to the existing parent session using the existing prompt path. The directive includes only validated plan title/goal/steps and instructs the model to update steps using `piwin_plan_set_step`, run verification, and produce a walkthrough summary.
- Subagent-driven creates one child for each `independentSteps` item, or one child per step when all steps are eligible. Use `worktree` + `explicit` apply policy by default for mutating tasks; use readonly for research-only steps. Seed each child with only its step goal, acceptance criteria, and project context. Do not pass secrets or arbitrary model-generated commands through the coordinator.
- Track child IDs, listen for completion, merge only completed children according to existing merge semantics, then run a parent verification/finalization prompt. A failed child fails the plan unless the user explicitly retries/continues later.
- Abort cancels active child sessions or aborts the parent run and persists `aborted` execution state without marking work done.
- Completion produces a bounded walkthrough summary containing mode, completed/failed steps, merged child sessions, verification result, and unresolved items.

- [ ] Write mock-host tests for inline execution, subagent spawn-per-step, duplicate click idempotency, child failure, abort, and final status transition.
- [ ] Run targeted tests; expected: FAIL before coordinator exists.
- [ ] Implement coordinator using existing session spawn/complete/merge APIs and normalized pushes.
- [ ] Run `pnpm --filter @piwin/agent-host test -- plan-execution`; expected: PASS.
- [ ] Run host typecheck and all host tests; expected: PASS.

### Task 6: Add conversation Process card and execution-mode buttons

**Files:**
- Modify: `apps/desktop/src/plan-card.tsx`
- Create/Modify: `apps/desktop/src/plan-card.test.tsx`
- Modify: `apps/desktop/src/chat-thread.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/host-request-adapters.ts`
- Modify: `apps/desktop/src/hooks/use-host-bootstrap.ts`
- Modify: `apps/desktop/src/styles/region-transcript.css`

**Interfaces:**

```ts
export type PlanExecutionHandler = (mode: PlanExecutionMode) => void;

export type PlanCardProps = {
  plan: SessionPlan;
  defaultOpen?: boolean;
  locale?: 'zh-CN' | 'en';
  onExecute?: PlanExecutionHandler;
  onAbort?: () => void;
};
```

UI behavior:

- For a draft skill plan, show the review copy equivalent to the reference: “请确认方案，点击 Proceed 或回复后我将即刻开始实施！” plus a compact plan card.
- Show `Process`/`Proceed` as the primary action only when no mode has been selected.
- Clicking Process reveals two explicit buttons: `subagent-driven` and `inline`; no execution begins before one is selected.
- For a long plan produced via `/write-plan` (alias of `writing-plans`), show `subagent-driven` first and visually recommended; do not hide inline, but label it as direct/current-session execution.
- Disable buttons while queued/running; show progress and current step. Offer `Abort` while running and a clear error with retry after failure.
- Preserve existing collapse/checklist behavior and keyboard activation. Buttons must have accessible labels and test IDs.
- App sends `{ type: 'plan/execute', request: { sessionId, planId, mode } }`; bootstrap consumes execution pushes and updates the plan state without parsing Pi-native events.

- [ ] Add component tests for draft rendering, Process reveal, long-plan recommendation, callback mode, disabled running state, and abort.
- [ ] Run the new Desktop card tests; expected: FAIL before UI changes.
- [ ] Implement props/callback wiring and localized copy.
- [ ] Add styling for the gray bordered artifact card and blue primary action matching the supplied screenshot, without hard-coded light-only colors.
- [ ] Run `pnpm --filter @piwin/desktop test -- plan-card`; expected: PASS.

### Task 7: Wire Desktop mock/host command paths and full verification

**Files:**
- Modify: `apps/desktop/src/host-client-mock.ts`
- Modify: relevant Desktop tests (`chat-thread.test.tsx`, `host-client-mock.test.ts`)
- Modify: `docs/dev-plan.md`
- Create/Modify: ADR only if the final worktree/apply policy differs from existing subagent decisions

- [ ] Add deterministic mock responses for `plan/execute`, `plan/abort`, and execution push events so UI tests can cover both modes.
- [ ] Add an integration-style Desktop test that clicks the card mode and asserts the command payload.
- [ ] Run touched package tests.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Manual smoke: invoke `/write-plan` on a small task, verify draft card; invoke a 4-step plan, verify both buttons and recommendation; run inline; create a subagent-driven run, verify child activity, merge, plan completion, and walkthrough summary; abort once and verify no duplicate execution.
- [ ] Update `docs/dev-plan.md` with the completed vertical slice and any intentionally deferred rich Walkthrough/comment artifact pane.

## Risks and Explicit Non-Goals

- Do not parse arbitrary Markdown headings in the UI as executable plans; only validated structured plan artifacts may show Process.
- Do not let the Desktop spawn Pi, shell, or subagents directly; all execution goes through typed host commands.
- Do not introduce a new generic “orchestrator” package or god module; keep pure classification in session and side effects in agent-host.
- Do not promise parallel child execution until worktree collision, merge ordering, and permission semantics are tested; the first implementation may queue independent children sequentially while retaining the subagent-driven contract.
- Do not add Google/Antigravity proprietary files or protocol assumptions; reproduce the user-visible lifecycle with piwin-native contracts.
- Rich document comments, artifact pane browsing, screenshots/browser recordings, and a first-class standalone Walkthrough artifact are deferred after the clickable execution vertical slice.

## Recommended Start Order

1. Task 1 contracts.
2. Task 2 classifier/validation.
3. Task 3 bundled `writing-plans` extension + `/write-plan` alias.
4. Task 4 structured creation tool.
5. Task 5 host execution coordinator.
6. Task 6 Desktop card.
7. Task 7 mock/integration/full verification.

# D-HOST-03 / D-HOST-04 — Design + Executable Plan

| Field | Value |
|-------|-------|
| Status | **H1+H2+H3 + residuals executed 2026-07-20** (see host-03-04-residuals.md) |
| Date | 2026-07-20 |
| Scope | **D-HOST-03** Sub-agent / plan mode · **D-HOST-04** Compaction UI |
| Canonical backlog | [`docs/todo-deferred.md`](../todo-deferred.md) §2.5 |
| PRD | [`docs/prd.md`](../prd.md) §4.1 AW-*, §4.7 gaps |
| ADR touchpoints | 0008 (tools/RPC), 0009 (product shell resume) |
| Binding | `AGENTS.md` — contracts first; only host imports Pi |
| Residuals plan | [`2026-07-20-host-03-04-residuals.md`](./2026-07-20-host-03-04-residuals.md) (03c/03d/04b/04c — **plan only**) |

---

## 0. Problem framing

### 0.1 What users need

| Capability | User intent | Today |
|------------|-------------|-------|
| **Plan mode** | Think in steps before (or while) coding; approve / revise a plan | Skills text only; no first-class plan object |
| **Sub-agent** | Delegate a bounded task (research, review, implement slice) without drowning main chat | Multiple sessions exist, but no parent/child link or spawn UX |
| **Compaction** | Context is full / expensive; summarize and continue | Pi emits `compaction_*`; host maps to `AgentEvent`; **UI ignores**; no manual compact IPC |

### 0.2 PRD constraints (product lock)

From PRD §4.7:

- **No sub-agents (v1 early):** *multi-session first; sub-agent later.*
- **No plan mode (v1 early):** *application-layer plan artifact* (not invent a second agent kernel).

From ADR 0009:

- Product **transcript** is chat history truth; Pi tree/DAG is deferred (**D-M2-01b**).
- Sub-agent v1 must **not** require multi-leaf Pi tree UI.

### 0.3 Pi 0.80.10 relevant surface (host-only)

| Pi API | Use for |
|--------|---------|
| `AgentSession.compact(customInstructions?)` | Manual compaction |
| `abortCompaction()` | Cancel |
| `setAutoCompactionEnabled` / `autoCompactionEnabled` | Toggle auto |
| Events `compaction_start` / `compaction_end` | Already mapped → `compaction/start` · `compaction/end` |
| `getUserMessagesForForking()` / fork-ish session ops | **Out of v1 sub-agent** unless spike proves stable (ties to D-M2-01b) |

**Decision lock for this plan:** Sub-agent v1 = **product multi-session with lineage**, not Pi fork. Plan mode = **artifact stored by piwin**, not a new Pi mode flag unless free.

---

## 1. Product design

### 1.1 Plan mode (D-HOST-03a)

#### Concept

A **Plan** is a structured, versioned document attached to a **session** (optionally project-scoped later):

```text
Plan {
  id, sessionId, projectPath
  status: draft | approved | executing | done | abandoned
  title
  goal
  steps: [{ id, title, detail?, status: pending|active|done|skipped }]
  revisions: number
  createdAt, updatedAt
  source: 'user' | 'assistant' | 'skill'
}
```

**Modes of use (UI):**

1. **Draft:** User (or model via skill) produces a plan; chat continues normally.
2. **Plan-first (optional toggle):** Composer shows “Plan mode” — first response expected to be plan-shaped; host may inject a system/reminder string via product prompt prefix (not a Pi mode).
3. **Execute:** User approves plan → “Execute step N” or “Execute all remaining” becomes follow-up prompts that **reference** the plan file (path injection), not a new runtime.

#### Non-goals (plan)

- Not a separate process / model sandbox.
- Not automatic step-by-step agent loop in host (that is sub-agent orchestration).
- Not replacing skills `writing-plans` / `executing-plans` — those **feed** the plan artifact.

#### UX (Desktop)

| Surface | Behavior |
|---------|----------|
| Chat header | Toggle **Plan mode** (session-local preference) |
| Plan panel | Side panel or collapsible under header: steps checklist, status, Approve / Abandon |
| Composer | When plan approved: quick actions “Next step”, “Revise plan” |
| Transcript | Plan create/update as system or special message kind `plan` in product transcript (optional display card) |

#### CLI

```text
piwin plan show --session <id>
piwin plan approve --session <id>
# v1 optional; Desktop first is OK
```

### 1.2 Sub-agent (D-HOST-03b) — multi-session first

#### Concept

A **child session** under the same project:

```text
SessionIndexRecord {
  ...existing
  parentSessionId?: string
  kind?: 'main' | 'subagent'
  subagentGoal?: string
  subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled'
}
```

Spawn flow:

1. User (or plan “Execute step”) requests **Spawn sub-agent** with goal string.
2. Host creates a **new** session (SDK path) with:
   - same `projectPath`, optional same model
   - product transcript + index linked via `parentSessionId`
   - initial user message = goal + context summary (optional: last N messages summary from parent, size-capped)
3. Parent chat shows a **SubAgentCard**: goal, status, “Open”, “Cancel” (abort child), “Merge summary” (copy last assistant reply into parent as a system/user note).

#### Non-goals (sub-agent v1)

- No shared tool process pool beyond existing MCP manager (children are normal sessions).
- No automatic recursive spawn trees (depth max **1** in v1).
- No Pi `fork()` / tree navigation (D-M2-01b).
- No parallel N agents UI (can spawn one; multiple sequential OK).

#### Permission

- Child sessions inherit project trust.
- Network/MCP/bash gates unchanged (per child session id).
- Optional: spawn requires confirm if goal empty or too long.

### 1.3 Compaction UI (D-HOST-04)

#### Concept

Surface Pi compaction that **already exists** in the event pipeline.

| User action | Host |
|-------------|------|
| Banner when auto-compact runs | React to `compaction/start` · `compaction/end` |
| Manual **Compact context** | IPC → `session.compact()` |
| Cancel compact | IPC → `abortCompaction()` if running |
| Toggle auto-compact | IPC get/set (persisted via Pi settings or piwin config overlay) |

#### UX

| Element | Behavior |
|---------|----------|
| Compact banner | “Compacting context…” with spinner; on end “Context compacted” toast/muted line |
| Session menu | Compact now… (optional instructions dialog) |
| Settings | Auto-compaction enabled (if host can read/write) |
| Transcript | Optional system line in product transcript: `[compaction] summary applied` (do not invent summary text if Pi doesn’t return it to UI) |

#### Non-goals (compaction)

- Do not reimplement summarizer in piwin.
- Do not delete product transcript on compact (product history stays; model context may shrink).
- RPC mode: if compact unavailable, capability flag + disabled button.

### 1.4 Relationship between the three

```text
                    ┌─────────────┐
                    │  Plan mode  │  structured steps (artifact)
                    └──────┬──────┘
           approve/execute │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
  main session      spawn sub-agent     continue main
  follow-ups        (child session)     with step prompt
         │                 │
         └────────┬────────┘
                  ▼
           context grows → compaction UI
```

Plan can **optionally** spawn a sub-agent for a step; v1 may only inject prompts into main session (simpler). Plan **must not** require sub-agent.

**v1 ship split (recommended):**

| Phase | Ship |
|-------|------|
| **H1** | Compaction UI only (D-HOST-04) — smallest, Pi API clear |
| **H2** | Plan artifact + panel (D-HOST-03a) |
| **H3** | Sub-agent spawn + card (D-HOST-03b) |

---

## 2. Technical design

### 2.1 Contracts

#### Compaction (H1)

```ts
// AgentEvent — already:
// | { type: 'compaction/start' }
// | { type: 'compaction/end' }
// Extend if Pi provides payload:
// | { type: 'compaction/end'; ok: boolean; message?: string }

// HostCommand
| { type: 'session/compact'; sessionId: string; customInstructions?: string }
| { type: 'session/compact-abort'; sessionId: string }
| { type: 'session/compaction-settings'; sessionId: string } // get
| { type: 'session/set-auto-compaction'; sessionId: string; enabled: boolean }

// HostResponse data
{ ok: boolean; message?: string }
{ autoCompactionEnabled: boolean }
```

#### Plan (H2)

```ts
// packages/contracts/src/plan.ts
export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'done' | 'abandoned';

export type PlanStep = {
  id: string;
  title: string;
  detail?: string;
  status: PlanStepStatus;
};

export type SessionPlan = {
  id: string;
  sessionId: string;
  projectPath: string;
  status: PlanStatus;
  title: string;
  goal: string;
  steps: PlanStep[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  source: 'user' | 'assistant' | 'skill';
};

// HostCommand
| { type: 'plan/get'; sessionId: string }
| { type: 'plan/set'; sessionId: string; plan: SessionPlan } // full replace with validation
| { type: 'plan/patch'; sessionId: string; patch: Partial<...> } // status/steps
| { type: 'plan/clear'; sessionId: string }
```

Storage: `~/.piwin/sessions/<sessionId>/plan.json` (alongside `transcript.json`).

#### Sub-agent (H3)

```ts
// SessionIndexRecord extensions
parentSessionId?: string;
kind?: 'main' | 'subagent';
subagentGoal?: string;
subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';

// HostCommand
| {
    type: 'session/spawn-subagent';
    parentSessionId: string;
    goal: string;
    model?: ModelRef;
  }
| { type: 'session/list-children'; parentSessionId: string }

// Response
{ sessionId: string; parentSessionId: string }
{ children: SessionSummary[] }
```

### 2.2 Host wiring

| Concern | Package / file |
|---------|----------------|
| Compact IPC | `host-runtime` → unwrap Pi session handle → `compact` / `abortCompaction` |
| Pi session access | Today product shell wraps live session; need `getLivePiSession()` or call through adapter method on handle |
| Auto-compact settings | Prefer Pi session getters/setters; if not reachable through shell, store overlay in `PiwinConfig.session.autoCompactionDefault` |
| Plan store | `@piwin/session` `plan-store.ts` pure FS |
| Sub-agent spawn | HostRuntime creates child via `host.createSession`, seeds prompt, updates index |
| Events | chat-reducer handles `compaction/*`; transcript optional system line |

**Adapter gap (must solve in H1):**

Product shell / mock must implement optional:

```ts
// SessionHandle extension (or host-private interface)
interface CompactionCapable {
  compact?(instructions?: string): Promise<{ ok: boolean; message?: string }>;
  abortCompaction?(): void;
  getAutoCompactionEnabled?(): boolean;
  setAutoCompactionEnabled?(enabled: boolean): void;
}
```

Mock: fake compact that emits start/end events after timeout.  
RPC: return capability false.

### 2.3 Desktop

| Feature | UI |
|---------|-----|
| H1 | Banner + Session menu Compact + Settings auto-toggle |
| H2 | `PlanPanel` + plan mode toggle + approve/execute actions |
| H3 | Spawn dialog + `SubAgentCard` list under parent chat |

Pet mapping: `compaction/start` → waiting animation (optional one-liner in pet state map).

### 2.4 Security / architecture rules

- Plan JSON: validate size (e.g. max 64KB), no executable fields.
- Sub-agent goal: max length; no auto-trust elevation.
- Compact: requires live session; abort running agent first (Pi does this).
- Children cannot spawn grandchildren in v1 (reject if parent.kind === 'subagent').

---

## 3. Executable phases

### Phase H0 — Spec freeze (½ day, no code)

- [ ] Confirm product choices below (defaults locked if no objection):
  1. Plan storage = per-session file under `~/.piwin/sessions/<id>/plan.json`
  2. Sub-agent = multi-session lineage, depth 1, no Pi fork
  3. Compact = Pi API only; product transcript retained
  4. Ship order H1 → H2 → H3
- [ ] Optional: short ADR 0010 “Plan artifact + multi-session subagent”

### Phase H1 — Compaction UI (D-HOST-04) — **start here**

| Task | Work | Exit |
|------|------|------|
| H1.1 | Contracts: compact IPC + optional compaction/end payload | types export |
| H1.2 | SessionHandle compaction capability on SDK wrap + mock | compact emits events |
| H1.3 | HostRuntime handlers | unit tests |
| H1.4 | chat-reducer: `compacting` flag + banner state | unit tests |
| H1.5 | Desktop: banner + Compact button + optional instructions | manual smoke |
| H1.6 | Auto-compact toggle if API reachable; else hide with doctor note | |
| H1.7 | RPC: disabled control + capability | |
| H1.8 | todo-deferred mark D-HOST-04 done | |

**Effort:** S–M · **Risk:** low–medium (shell → Pi handle access)

### Phase H2 — Plan mode (D-HOST-03a)

| Task | Work | Exit |
|------|------|------|
| H2.1 | contracts `plan.ts` + validate-plan pure | tests |
| H2.2 | session `plan-store.ts` | tests |
| H2.3 | IPC plan/get|set|patch|clear | host tests |
| H2.4 | Desktop PlanPanel + toggle | |
| H2.5 | Approve → status; Execute step → follow_up/prompt with plan path injection | |
| H2.6 | Optional: parse assistant ```plan JSON fences into plan/set (later residual) | skip if large |
| H2.7 | Docs + backlog D-HOST-03 partial | residual D-HOST-03b |

**Effort:** M · **Risk:** low

### Phase H3 — Sub-agent multi-session (D-HOST-03b)

| Task | Work | Exit |
|------|------|------|
| H3.1 | Session index lineage fields | migration tolerant load |
| H3.2 | `session/spawn-subagent` + list-children | tests |
| H3.3 | Seed child with goal (+ optional parent summary cap) | |
| H3.4 | Desktop SubAgentCard + spawn modal | |
| H3.5 | Cancel = abort + mark cancelled; merge summary = copy last assistant text to parent | |
| H3.6 | Depth guard; pet/state ignore or map running children | |
| H3.7 | Mark D-HOST-03 done; residual Pi-fork = D-HOST-03c if needed | |

**Effort:** M–L · **Risk:** medium (UX + index)

---

## 4. Task checklist (copy into session todos)

### H1 Compaction
- [x] T-H1.1 contracts compact commands
- [x] T-H1.2 mock + SDK compact capability
- [x] T-H1.3 HostRuntime handlers + tests
- [x] T-H1.4 chat-reducer compacting state
- [x] T-H1.5 Desktop banner + actions
- [x] T-H1.6 auto-compact settings IPC (Desktop toggle residual D-HOST-04c)
- [x] T-H1.7 RPC degradation
- [x] T-H1.8 backlog + smoke

### H2 Plan
- [x] T-H2.1 plan types + validation
- [x] T-H2.2 plan-store FS
- [x] T-H2.3 IPC + host
- [x] T-H2.4 PlanPanel UI
- [x] T-H2.5 execute/revise prompts
- [x] T-H2.6 backlog partial/done

### H3 Sub-agent
- [x] T-H3.1 index lineage
- [x] T-H3.2 spawn + list-children IPC
- [x] T-H3.3 seed + depth guard
- [x] T-H3.4 SubAgentCard UI
- [x] T-H3.5 cancel (merge summary residual D-HOST-03c)
- [x] T-H3.6 backlog close D-HOST-03

---

## 5. Residuals created by this design

| ID | When |
|----|------|
| D-HOST-03c | Pi-native fork/subagent if ever needed |
| D-HOST-03d | Auto-parse assistant plan fences → plan.json |
| D-HOST-03e | Parallel multi-subagent / depth >1 |
| D-HOST-04b | Show compaction summary text if Pi exposes it |
| D-HOST-04c | Project-default auto-compact in piwin config only |

Add to `todo-deferred.md` when phases ship.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Product shell cannot reach `compact()` | Extend shell to hold live handle ref (already has ensureLive) |
| Auto-compact settings live only in Pi ~/.pi | Document; optional piwin overlay later |
| Plan becomes second chat | Keep plan panel; don’t fork transcript |
| Sub-agent confuses users | Clear card + depth 1 + no auto-spawn |
| Context steal via parent summary | Cap summary bytes; no secrets from parent tools dumps |

---

## 7. Effort & sessions

| Phase | Effort | Session |
|-------|--------|---------|
| H0 | S | design affirm |
| H1 | S–M | **Session 1 — start here** |
| H2 | M | Session 2 |
| H3 | M–L | Session 3 |

---

## 8. Ready to execute

**Default start:** Phase **H1 Compaction UI** (D-HOST-04) — contracts → host compact capability → Desktop banner.

**Do not start H3 before H1** unless product explicitly prioritizes multi-session spawn over context health.

When implementing, update `docs/todo-deferred.md` per slice and open residual IDs from §5 as needed.

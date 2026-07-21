# D-HOST-03/04 Residuals — Design + Executable Plan

| Field | Value |
|-------|-------|
| Status | **Executed 2026-07-20** (RH0–RH4: 04c · 04b full · 03c · 03d L1+L2) |
| Date | 2026-07-20 |
| Scope | Residual polish after H1–H3: **D-HOST-03c · D-HOST-03d · D-HOST-04b · D-HOST-04c** |
| Parent plan (shipped) | [`2026-07-20-host-03-04-plan-compaction.md`](./2026-07-20-host-03-04-plan-compaction.md) |
| Canonical backlog | [`docs/todo-deferred.md`](../todo-deferred.md) |
| Binding | `AGENTS.md` — contracts first; only `agent-host` imports Pi; product transcript remains chat truth (ADR 0009) |

> **Executed 2026-07-20.** RH0–RH4 landed in contracts / session / agent-host / desktop; see verification notes below and `docs/todo-deferred.md`.

---

## 0. Baseline (already shipped — do not re-implement)

| Track | Shipped surface | Gap this plan closes |
|-------|-----------------|----------------------|
| **H1 Compaction** | `session/compact*`, banner, Compact button, `capabilities.compaction` | No durable auto-compact default; end payload thin (`ok`/`message` only) |
| **H2 Plan** | `plan.json`, `plan/get|set|clear|approve`, PlanPanel, approve → prompt inject | Steps stay `pending`; no host/tool-driven progress |
| **H3 Sub-agent** | `session/spawn|list-children|cancel-subagent`, depth max 1, SubAgentPanel Open/Cancel | No complete/merge into parent transcript; status rarely leaves `running` except cancel |

### 0.1 Explicit residual IDs

| ID | One-liner | User-visible value |
|----|-----------|--------------------|
| **D-HOST-04c** | Default auto-compaction from piwin config/project overlay | “I don’t want to re-toggle every session” |
| **D-HOST-04b** | Richer compaction end summary when Pi provides it | “What did compact do?” not just “Context compacted” |
| **D-HOST-03c** | Merge sub-agent result into parent chat | “Child finished — parent sees a summary without manual copy” |
| **D-HOST-03d** | Plan step progress beyond manual draft | “Plan checklist moves as work progresses” |

---

## 1. Decision locks (freeze before coding)

These defaults apply unless a future ADR supersedes them.

| # | Decision | Rationale |
|---|----------|-----------|
| L1 | **Product transcript is still the only chat truth.** Merge writes a parent **transcript** system (or assistant-system) message — not Pi tree rewrite. | ADR 0009 |
| L2 | **Sub-agent merge is user-initiated first** (`Complete & merge`). Optional auto-merge is a sub-flag default **off**. | Avoid surprising parent chat pollution |
| L3 | **Plan step progress is host-owned state** in `plan.json`. Prefer **explicit tool / IPC** over free-text parsing. | Deterministic, testable; model output is untrusted |
| L4 | **Auto-compact default lives in product config** (`~/.piwin`), applied when a live handle is ready — not only session-local RAM. | Survives restart |
| L5 | **Compaction summary is best-effort mapping** from Pi payloads; never invent token counts. | Honest UI |
| L6 | **Depth max 1 and no Pi fork** remain. Residuals must not reintroduce nested spawn or fork. | Parent plan H3 |
| L7 | **RPC remains capability-gated.** Features that need SDK compact/tools degrade cleanly. | ADR 0008 |

---

## 2. Design — D-HOST-04c · Project/global auto-compact defaults

### 2.1 Problem

Today:

- Mock/SDK expose `get/setAutoCompactionEnabled` on the live handle.
- IPC `session/set-auto-compaction` only mutates **current live session**.
- After process restart / product-shell re-create, preference is lost.
- Desktop has no Settings control for the default.

### 2.2 Product behavior

**Resolution order** (highest wins):

```text
1. Live session override (if user toggled this session via IPC)
2. Project preference (optional)
3. Global PiwinConfig default
4. Pi/SDK built-in default (unknown — treat as “unset”)
```

**UX:**

| Surface | Behavior |
|---------|----------|
| Settings → Session / Context | Toggle **“Auto-compact by default”** (global) |
| Optional v1.1 | Project panel checkbox **“Override auto-compact for this project”** |
| Chat | Optional small “Auto-compact: on/off” indicator near Compact button; click opens settings or toggles session override |
| Doctor | Report effective default + whether live session differs |

### 2.3 Data model

```ts
// packages/contracts — PiwinConfig extension
export type CompactionConfig = {
  /** Applied when a new live session is created if no project override. Default true. */
  autoEnabledDefault: boolean;
};

// PiwinConfig
compaction?: CompactionConfig;

// ProjectRecord (optional phase 2 of this residual)
sessionPolicy?: {
  autoCompaction?: boolean; // undefined = inherit global
};
```

**Session-local override** (runtime only, not required on disk for v1):

- HostRuntime map: `sessionId → boolean | undefined`
- `session/set-auto-compaction` sets map **and** Pi handle
- On `ensureLive` / first bind after create: apply effective default then session override

### 2.4 IPC / host

| Command | Change |
|---------|--------|
| `session/compaction-settings` | Extend response: `{ supported, autoCompactionEnabled, source: 'session' \| 'project' \| 'global' \| 'unknown', globalDefault, projectDefault? }` |
| `session/set-auto-compaction` | Persist session override in host memory; apply to handle |
| `config/get` · `config/set` | Carry `compaction.autoEnabledDefault` via existing config store (validate boolean) |

**Apply timing:**

1. After `bindSession` when handle has `setAutoCompactionEnabled`
2. After product-shell first `createLiveSession`
3. On `config/set` that changes global default: update **new** sessions only (do not mass-rewrite running sessions unless user confirms — v1: new only)

### 2.5 Desktop

- `SettingsPanel`: one checkbox bound to `config.compaction.autoEnabledDefault`
- Composer Compact cluster: read `session/compaction-settings` on session focus; show muted label
- Mock `host-client`: honor config field for consistency in browser mock

### 2.6 Tests / exit

| Test | Assert |
|------|--------|
| config-store | load/save `compaction.autoEnabledDefault` |
| host-runtime | create session → settings.source global; set session override → source session |
| mock session | set/get round-trip still works |
| desktop typecheck | Settings compiles |

**Exit criteria:** New SDK/mock sessions inherit global default after restart; UI can change default without touching code; RPC still reports `supported: false` / capability false without crash.

### 2.7 Non-goals (04c)

- Per-model compact thresholds / token budgets UI
- Changing Pi’s internal auto-compact algorithm
- Forcing compact on every N messages from host (use Pi auto or manual Compact)

**Effort:** S · **Risk:** low · **Deps:** none beyond existing compact IPC

---

## 3. Design — D-HOST-04b · Richer compaction summary

### 3.1 Problem

`compaction/end` already allows optional `ok` + `message`. UI shows a short banner. Users still do not know:

- Whether tokens were reduced
- What summary Pi wrote into **model** context (if any)
- Whether compact failed with a structured reason

Product **chat transcript must not be rewritten** by compact (already locked). Summary is **status UX**, optional system line.

### 3.2 Spike first (mandatory gate)

Before widening contracts:

| Step | Work | Outcome |
|------|------|---------|
| S1 | Inspect Pi 0.80.x `compact()` return type + `compaction_end` event shape (from installed package types / docs / runtime log in mock-off session) | Field inventory table |
| S2 | Capture 1–2 real event fixtures under `packages/agent-host/src/fixtures/compaction-*.json` | Golden inputs for mapper |
| S3 | If Pi exposes **nothing** beyond success/fail | Ship **bounded** UI only (below) and re-defer “token delta” |

**Bounded ship if Pi is thin:**

- Keep `message` when present
- Always show duration (host-measured start→end)
- Optional host-generated line: `"Compaction finished"` / `"Compaction failed: …"`
- **Do not fabricate** token counts

**Full ship if Pi is rich** (example fields — only map if real):

```ts
// AgentEvent extension (illustrative)
{ type: 'compaction/end';
  ok?: boolean;
  message?: string;
  summary?: string;          // model-facing summary text if Pi exposes
  tokensBefore?: number;
  tokensAfter?: number;
  durationMs?: number;       // host-filled even if Pi omits
}
```

Also extend `SessionCompactResult` similarly for the RPC response of `session/compact`.

### 3.3 Host mapping rules

| Source | Rule |
|--------|------|
| `event-map` | Defensive `readString` / `readNumber` on known keys; ignore unknowns |
| HostRuntime | On compact start, store `startedAt`; on end event or compact() resolve, attach `durationMs` when pushing/responding |
| Transcript | **Optional** append system message if `config.compaction.writeTranscriptNote === true` (default **false** for v1 residual — avoid noise). Prefer banner-only unless user opts in later. |

### 3.4 Desktop UX

| Element | Behavior |
|---------|----------|
| Info banner | Title + optional expandable details (summary snippet ≤ 500 chars, token line if present) |
| Dismiss | Clear `lastCompactionMessage` after N seconds or “Dismiss” |
| Compact response error | Keep using `error` banner path |

### 3.5 Tests / exit

| Test | Assert |
|------|--------|
| event-map fixtures | Maps all known fields; ignores junk |
| mock compact | Returns non-empty message; optional fake tokens for UI |
| chat-reducer | Stores detail fields without breaking old events |

**Exit criteria:** UI never lies about tokens; with real Pi payload, richer text appears; without it, UX still coherent.

### 3.6 Non-goals (04b)

- Showing Pi’s full internal compaction prompt chain
- Reverting compaction
- Editing the model summary after compact

**Effort:** S after spike · **Risk:** low–medium (depends on Pi opacity) · **Deps:** spike S1–S3

---

## 4. Design — D-HOST-03c · Sub-agent summary → parent chat

### 4.1 Problem

Today:

- Child is a full session with its own `transcript.json`
- Parent has no automatic link in the chat stream after spawn
- Status stays `running` until `cancel-subagent` → `cancelled`
- User must Open child and mentally transfer results

### 4.2 Product concept

**Merge** = append a single **parent transcript** message that:

1. Identifies the child (id, name, task)
2. Carries a **bounded summary** of child work
3. Links navigation (“Open child session”)
4. Is **idempotent** (no double-merge spam)

```text
Parent transcript
  … prior messages …
  [system] Sub-agent “Investigate auth” finished (done)
           Summary: …
           childSessionId=…
```

Child transcript is **not** deleted or rewritten (except status metadata on index).

### 4.3 Lifecycle (status machine)

```text
running ──Complete──► done ──Merge──► done (+ mergedAt)
   │                    │
   │                    └── optional auto-merge (flag off by default)
   │
   ├──Cancel──► cancelled ── optional Merge (partial summary) ──► cancelled (+ mergedAt)
   └──fail (host detected) ──► failed
```

**Detecting `done` (v1):**

| Approach | Use in plan |
|----------|-------------|
| **A. Explicit Complete** | **Primary.** IPC `session/complete-subagent` sets `subagentStatus: 'done'`, does not require model cooperation |
| **B. Heuristic idle** | **Deferred.** (agent_end + no tools + quiet period) — flaky without Pi lifecycle ownership |
| **C. Model tool `subagent_done`** | **Out of v1 residual** — requires custom tool + model compliance |

When completing, host should `abort()` if still streaming (same as cancel soft path).

### 4.4 Summary generation (deterministic v1)

**No second LLM call** in this residual (cost/latency/privacy).

Algorithm (`@piwin/session` pure helper):

```text
buildSubagentMergeSummary(childMessages, opts):
  - take assistant messages with status done
  - concatenate text, skip pure tool dumps unless opts.includeToolNames
  - cap MAX_SUMMARY_CHARS (e.g. 4000)
  - if empty: "Sub-agent produced no assistant text."
  - prefix with task line from index.task
```

Optional later residual (not this plan): `summaryMode: 'extractive' | 'llm'` with host LLM call.

### 4.5 Data model

```ts
// SessionIndexRecord extensions
subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
mergedAt?: string;
mergeMessageId?: string; // parent transcript message id
summaryPreview?: string; // short for list cards
```

```ts
// HostPush (optional but recommended)
| { type: 'subagent/updated'; parentSessionId: string; child: SessionSummary }
| { type: 'subagent/merged'; parentSessionId: string; childSessionId: string; messageId: string }
```

If push types are deferred, Desktop can re-`session/messages` parent after merge response.

### 4.6 IPC

| Command | Semantics |
|---------|-----------|
| `session/complete-subagent` | `{ sessionId, status?: 'done' \| 'failed' }` → abort live if needed; set index status; **does not** merge |
| `session/merge-subagent` | `{ childSessionId, force?: boolean }` → validate parent; if `mergedAt` and !force → fail or no-op success with existing id; build summary; append parent transcript; set mergedAt/mergeMessageId; push |
| `session/cancel-subagent` | Keep; allow merge after cancel (partial) |

**Permission / trust:** same project as parent; child must have `parentSessionId`; depth 1 only.

**Transcript write path:** reuse `appendTranscriptMessage` + existing product shell rules. Message shape:

```ts
{
  id: newId,
  role: 'system',
  text: formatMergeCard(...), // markdown-friendly plain text
  createdAt,
  status: 'done',
}
```

### 4.7 Desktop UX

| Control | Where |
|---------|-------|
| **Complete** | SubAgentPanel card when `running` |
| **Merge into parent** | Card when status ∈ {done, failed, cancelled} && !mergedAt |
| **Complete & merge** | Single button = complete then merge (primary CTA) |
| Badge | `merged` on card after success |
| Parent chat | System bubble appears if parent is active session; else next resume loads it |

**Active session rule:** If user is viewing the child when merge fires, do **not** inject into wrong reducer — only parent transcript file is authoritative; switch-to-parent optional toast.

### 4.8 Tests / exit

| Test | Assert |
|------|--------|
| pure `buildSubagentMergeSummary` | Cap, empty, multi-assistant |
| host-runtime | complete → status done; merge → parent transcript has system msg; second merge no-op/force |
| spawn→complete→merge e2e in host tests | index fields set |
| desktop mock | buttons call IPC |

**Exit criteria:** From parent, user can Complete & merge without opening child; parent history shows one summary; re-merge does not spam; cancel path can still merge partial work.

### 4.9 Non-goals (03c)

- Auto-streaming child tokens into parent mid-run
- Full transcript embed (only summary)
- Nested sub-agents
- Editing parent mid-stream merge races (serialize with simple mutex per parentSessionId)

**Effort:** M · **Risk:** medium (status lifecycle + UX clarity) · **Deps:** existing spawn + transcript

---

## 5. Design — D-HOST-03d · Plan step progress

### 5.1 Problem

Plan steps exist and inject as context when approved/executing, but:

- All steps remain `pending` after approve
- No path for model or host to mark step active/done
- User cannot check off steps in PlanPanel after save (draft editor overwrites wholesale)

### 5.2 Layered approach (ship in order)

| Layer | Name | Ship in this residual? |
|-------|------|------------------------|
| **L1** | Manual step status via IPC + PlanPanel checkboxes | **Yes — required** |
| **L2** | Host custom tool `piwin_plan_set_step` when plan approved/executing | **Yes — preferred automation** |
| **L3** | Parse assistant fenced `plan-progress` JSON | **No** (defer; untrusted/brittle) |
| **L4** | Infer steps from tool names/paths | **No** (too magic for v1) |

### 5.3 L1 — Manual step updates

#### Contracts

```ts
// IPC
| { type: 'plan/update-step'; sessionId: string; stepId: string; status: PlanStepStatus; detail?: string }
| { type: 'plan/set-status'; sessionId: string; status: PlanStatus } // e.g. executing | done | abandoned
```

Rules:

- Unknown stepId → fail
- Updating a step on `draft` plan is allowed (prep)
- First step → `active` or any step → `done` while plan is `approved` **auto-promotes** plan to `executing` (optional but recommended)
- All steps `done|skipped` → optionally auto plan `done` (config flag, default **true**)

#### PlanPanel UX

- Read-only step list when status ≠ draft (or always show checklist)
- Checkbox / status select per step
- “Mark next active” button: first pending → active, previous active → done (helper)
- Keep draft editor for title/goal/steps structure; status edits use update-step

### 5.4 L2 — Tool-driven progress (model-facing)

#### Tool definition (`@piwin/agent-host` session tools)

```text
name: piwin_plan_set_step
params: { stepId: string, status: pending|active|done|skipped, note?: string }
```

**Registration gate:** only when session has plan with status `approved` | `executing`.

**Implementation:** load plan → validate → save → `push plan/updated` → return short ack.

**Prompt inject:** extend `formatPlanForModelContext` to include:

```text
Instruction: When you finish a step, call piwin_plan_set_step.
Only one step should be active at a time.
```

**Concurrency:** one writer; tool calls serialized via plan revision check (reject stale revision optional; v1 last-write-wins with revision bump).

#### Security

- No arbitrary path writes
- Tool cannot change plan goal/title structure (only step status + optional note in detail)
- Max note length (e.g. 500 chars)
- RPC mode: tool absent (stock custom tools unsupported) — document degradation

### 5.5 Plan status vs step status (state machine)

```text
draft ──approve──► approved ──first progress──► executing ──all terminal──► done
                      │                              │
                      └──────── abandon ─────────────┴──► abandoned
```

Terminal step statuses: `done` | `skipped`.

### 5.6 Desktop / chat

- PlanPanel live-updates on `plan/updated` push (already partially there)
- Optional compact checklist strip under chat header when plan is executing (nice-to-have; not blocking)
- Pet mapping optional: plan step done → idle animation (skip if cost)

### 5.7 Tests / exit

| Test | Assert |
|------|--------|
| validate + update-step | transitions + auto plan done |
| tool unit | rejects without plan; updates with plan |
| host-runtime | IPC + tool path both persist plan.json |
| formatPlanForModelContext | includes set_step instruction when executing |

**Exit criteria:** User can check off steps; model can update via tool in SDK mode; plan panel reflects progress; prompt inject shows current statuses.

### 5.8 Non-goals (03d)

- Automatic multi-step agent loop in host (“execute all remaining” as a kernel)
- Parsing free-form “Step 2 done” prose
- Multi-user collaborative plan editing

**Effort:** M · **Risk:** medium (tool registration + UX states) · **Deps:** H2 plan store; for L2 also session-tools / customTools path

---

## 6. Cross-cutting concerns

### 6.1 Package touch map

| Residual | contracts | session | agent-host | project | desktop |
|----------|-----------|---------|------------|---------|---------|
| 04c | config (+ optional project) | — | apply default on bind; settings IPC | optional policy | SettingsPanel |
| 04b | AgentEvent / CompactResult | — | event-map + duration | — | banner details |
| 03c | index fields + IPC + optional push | summary pure + transcript append | complete/merge handlers | — | SubAgentPanel |
| 03d | plan IPC + maybe tool contracts | plan-store updates | tool + IPC | — | PlanPanel |

No new top-level packages. No app → Pi imports.

### 6.2 Config / FS paths (recap)

```text
~/.piwin/config.json              # compaction.autoEnabledDefault
~/.piwin/projects.json            # optional sessionPolicy.autoCompaction
~/.piwin/sessions/<id>/plan.json
~/.piwin/sessions/<id>/transcript.json
~/.piwin/sessions-index/index.json  # subagentStatus, mergedAt, …
```

### 6.3 Failure modes

| Failure | Handling |
|---------|----------|
| Merge while parent missing | fail clear error |
| Compact settings on RPC | supported:false; hide toggle |
| Tool plan update without plan | tool error string to model |
| Concurrent merge | mutex / single-flight per parent |
| Oversized summary | hard cap + truncation marker `…[truncated]` |

### 6.4 Observability

- `host/log` info on merge and plan auto-status transitions
- No logging of full child transcript body beyond length metrics

---

## 7. Execution waves (recommended order)

```text
Wave RH0  Spike compaction payload (04b gate)          ½ day
   │
   ├─► Wave RH1  D-HOST-04c auto-compact defaults      S     (parallel with RH0 tail)
   │
   ├─► Wave RH2  D-HOST-04b summary UI (bounded/full)  S
   │
   ├─► Wave RH3  D-HOST-03c complete + merge           M
   │
   └─► Wave RH4  D-HOST-03d L1 manual + L2 tool        M
```

**Why this order:**

1. **RH0/RH1/RH2** are small, isolated, low risk — unblocks Settings polish and honest compaction UX.
2. **RH3** is highest remaining **product** value for multi-session story.
3. **RH4** touches tools + plan UX; benefits from stable plan IPC habits after H2; should not block merge.

**Parallelism:** RH1 ∥ RH0. RH2 after RH0 decision. RH3 ∥ RH4 only if two owners; prefer sequential for one agent.

---

## 8. Task checklists (executable)

### Wave RH0 — Compaction payload spike (D-HOST-04b gate)

- [x] **T-RH0.1** Locate Pi `compact` / `compaction_end` types in installed `@earendil-works/pi-coding-agent` (or runtime log)
- [x] **T-RH0.2** Write field inventory table into this plan §3.2 (amend doc) or short note under `docs/notes/`
- [x] **T-RH0.3** Decide **bounded** vs **full** ship; set D-HOST-04b acceptance bar
- [x] **T-RH0.4** Add 1–2 JSON fixtures (even if empty-rich) for mapper tests

**Exit:** Written decision: which fields will be mapped.

---

### Wave RH1 — D-HOST-04c

- [x] **T-RH1.1** `CompactionConfig` on `PiwinConfig` + default in `createDefault*` / config-store coerce
- [x] **T-RH1.2** Host: effective default resolution + apply on bind/live create
- [x] **T-RH1.3** Extend `session/compaction-settings` response with `source` + defaults
- [x] **T-RH1.4** SettingsPanel checkbox + config/set round-trip
- [x] **T-RH1.5** Tests: config-store + host-runtime inherit default
- [x] **T-RH1.6** Optional: project override on `ProjectRecord` (only if RH1.1–1.5 green and time left)
- [x] **T-RH1.7** Mark D-HOST-04c done in `todo-deferred.md`

**Exit:** Restart host → new session inherits saved default.

---

### Wave RH2 — D-HOST-04b

- [x] **T-RH2.1** Widen `compaction/end` / `SessionCompactResult` per RH0 decision
- [x] **T-RH2.2** event-map + host durationMs
- [x] **T-RH2.3** chat-reducer detail state + dismissible banner
- [x] **T-RH2.4** Mock emits richer fixture for UI
- [x] **T-RH2.5** Tests fixture-based
- [x] **T-RH2.6** Mark D-HOST-04b done (or “bounded done” + note)

**Exit:** Manual compact shows useful detail without false token claims.

---

### Wave RH3 — D-HOST-03c

- [x] **T-RH3.1** Index fields `mergedAt`, `mergeMessageId`, `summaryPreview`
- [x] **T-RH3.2** Pure `buildSubagentMergeSummary` + tests
- [x] **T-RH3.3** IPC `session/complete-subagent` + `session/merge-subagent`
- [x] **T-RH3.4** Host mutex + idempotent merge
- [x] **T-RH3.5** Optional HostPush `subagent/merged` (or re-fetch messages)
- [x] **T-RH3.6** SubAgentPanel: Complete / Merge / Complete & merge
- [x] **T-RH3.7** Parent chat shows system merge bubble when active
- [x] **T-RH3.8** Host integration test spawn→complete→merge
- [x] **T-RH3.9** Mark D-HOST-03c done

**Exit:** Parent transcript contains one merge card; re-merge safe.

---

### Wave RH4 — D-HOST-03d

- [x] **T-RH4.1** IPC `plan/update-step` + `plan/set-status` + tests
- [x] **T-RH4.2** PlanPanel checklist UX for non-draft
- [x] **T-RH4.3** Auto plan status transitions (approved→executing→done)
- [x] **T-RH4.4** Register `piwin_plan_set_step` when plan approved/executing
- [x] **T-RH4.5** Update `formatPlanForModelContext` instructions
- [x] **T-RH4.6** Tool unit tests + host test
- [x] **T-RH4.7** Document RPC degradation (no tool)
- [x] **T-RH4.8** Mark D-HOST-03d done; leave L3/L4 as new residual IDs if desired

**Exit:** Manual checkoff works; SDK model tool updates plan.json + UI via push.

---

## 9. Verification matrix (per residual)

| Residual | typecheck packages | unit tests | manual smoke |
|----------|--------------------|------------|--------------|
| 04c | contracts, agent-host, desktop | config-store, host-runtime | Settings toggle → new session settings |
| 04b | contracts, agent-host, desktop | event-map, chat-reducer | Compact → banner detail |
| 03c | contracts, session, agent-host, desktop | summary pure, host-runtime | Spawn → Complete & merge → parent system msg |
| 03d | contracts, session, agent-host, desktop | plan-store, tool, host | Checkbox + (SDK) tool call updates steps |

Root: `pnpm --filter @piwin/contracts typecheck && pnpm --filter @piwin/session test && pnpm --filter @piwin/agent-host test && pnpm --filter @piwin/desktop typecheck`

---

## 10. Effort & risk summary

| ID | Effort | Risk | Value | Notes |
|----|--------|------|-------|-------|
| D-HOST-04c | S | low | medium | Do first if polishing Settings |
| D-HOST-04b | S | low–med | medium | Spike may shrink scope |
| D-HOST-03c | M | medium | **high** | Core multi-session story completion |
| D-HOST-03d | M | medium | high | L1 alone already useful; L2 unlocks agent autonomy |

**Total estimate:** ~3–5 focused agent/dev days if sequential; less if RH1/RH0 parallel.

---

## 11. Still deferred after this plan (do not sneak in)

| Item | Why |
|------|-----|
| LLM-generated merge summaries | Cost, privacy, non-determinism |
| Plan fence parsing (L3) | Untrusted model text |
| Tool-path step inference (L4) | False positives |
| Sub-agent depth > 1 / Pi fork | Architecture |
| Auto-merge default on | Chat noise |
| Compaction transcript notes default on | Noise |
| Windows keychain / signing / Tauri e2e | Different residual waves |

---

## 12. Backlog / doc hygiene (when executing)

1. Keep this file Status → `RH1 in progress` / `executed` as waves complete.
2. For each done residual: strike-through in `docs/todo-deferred.md` with date + one-line evidence.
3. Cross-link from parent plan § residuals.
4. If RH0 finds zero Pi fields: mark D-HOST-04b **bounded done** and open `D-HOST-04b2` only if Pi upgrades later.

---

## 13. Suggested first implementation session (when you say “execute”)

1. RH0 spike notes (30–60 min)
2. RH1 full (04c)
3. RH2 bounded or full (04b)
4. Stop for review — then RH3 / RH4 in following sessions

**Do not start RH3+RH4 in the same rush as RH1** unless staffing allows; merge and plan tools deserve careful review.

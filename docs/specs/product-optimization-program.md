# Program Spec — Product Optimization (主路径打磨 + 半成品收口)

| Field | Value |
|-------|-------|
| Status | **P0 shipped · P1 partial · P2 spike done (Shell preview freeze) — 2026-07-22** |
| Date | 2026-07-22 |
| Trigger | Structure debt largely closed; product still feels rough on daily path |
| Supersedes (priority order) | Raw CE surface expansion without polish; drip-feed UI renames |
| Related | [`product-depth-competitive-alignment.md`](./product-depth-competitive-alignment.md), [`product-status.md`](../product-status.md), [`todo-deferred.md`](../todo-deferred.md) §2.10–2.11, ADR 0011/0012/0013, PRD, `AGENTS.md` |
| Binding | contracts-first · apps ↛ Pi · dual host honesty · `~/.piwin` single root · CLI↔Desktop same host |
| Backlog prefix | **PO-*** (Product Optimization) |

---

## 0. One-liner

在 **结构债可收口** 的前提下，把 piwin 从「功能很多、用起来糙」收敛成 **每天可靠的本地 Agent Shell**：磨亮主路径、诚实收口半成品、用 spike 决定重能力（真 PTY），**不开** 远程/第二内核/大重设计。

---

## 1. Context (baseline 2026-07-22)

### 1.1 Already done (do not re-plan)

| Area | Evidence |
|------|----------|
| Session lifecycle | rename / archive / unarchive / delete / duplicate / pin / search (PD-SESS-*) |
| Capability honesty | `capabilities.pty=false`, shell preview, doctor/Settings matrix (PD-TRUE-*) |
| Structure | App hooks + chrome components; host-client mock split; domain + session-live commands (PD-STR-*) |
| Feedback core | notification queue + AppErrorBoundary (PD-UX partial) |
| Docs seed | `docs/product-status.md` |

### 1.2 Remaining product pain

1. **Trust system one-way** — project-remember permissions cannot be listed/revoked in UI.
2. **Inconsistent empty/loading** — EmptyState/Spinner exist in ui-kit but panels underuse them.
3. **Content thin** — only 5 bundled skills vs PRD baseline list.
4. **Automation half-wired** — hooks thin/low personal use; cron/todo need honest finish or experimental labels.
5. **Sub-agent isolation opaque** — worktree/readonly not first-class in UI.
6. **Terminal still preview** — ADR 0013 Tauri PTY not spiked/shipped.
7. **Hubs rough** — Skills Store / MCP Registry install UX incomplete.
8. **A11y gaps** — focus chains, Escape, menus (stabilization residual).

### 1.3 Strategic principle

```text
Deepen daily path  >  finish half-built surfaces honestly  >  heavy native (PTY)
Never: broaden remote/gateway or second kernel while main path still rough
```

---

## 2. Goals

1. **Daily path feels finished**: open → trust → chat → tools → permission → session manage without spelunking host-log.
2. **Honesty preserved**: every yellow/red capability stays labeled until exit criteria met; never silent degrade.
3. **Content baseline**: default skills set matches PRD draft (thin SKILL.md OK).
4. **Trust is reversible**: remembered permissions visible and revocable per project.
5. **Heavy terminal decision made with evidence**: Tauri PTY spike gate before full xterm investment.
6. **Execution discipline**: contracts-first; Desktop + CLI parity or documented CLI degradation; tests for pure logic / host commands.

### Non-goals (this program)

| Non-goal | Why |
|----------|-----|
| W4 personal gateway / tunnel | remote surface |
| Cloud multi-tenant / hosted marketplace | private-first |
| Full Pi JSONL multi-leaf tree UI | ADR 0009 product shell |
| Full RPC worker isolation (D-HOST-01b) | residual; honesty only here |
| Electron / second agent kernel | AGENTS.md ban |
| Claude PreToolUse hook policy dual-kernel | L3 locked |
| Visual redesign / new design system | Atlas tokens only |
| Complex git DAG / force-push | out of v1 |
| Perfect LiveAgent parity checklist | capability *feel*, not feature clone |

---

## 3. Locked decisions (carry forward + new)

| ID | Decision | Source |
|----|----------|--------|
| L1 | Archive-first session delete | Product Depth |
| L2 | Fork = product transcript duplicate | Product Depth |
| L3 | Hooks = post-event only; thin priority | Product Depth + user |
| L4 | Interactive PTY = Tauri (not node-pty) | ADR 0013 |
| **L5** | Product Optimization priority: **A polish → B half-built → C PTY spike** | 2026-07-22 product review |
| **L6** | Hooks not a product push; automation work stays **minimal + honest** | user: rarely used |
| **L7** | PTY: **spike-gated** — full xterm only if spike green; else permanent Shell preview | 2026-07-22 |
| **L8** | Bundled skills: **thin content first**, quality expansion later | anti-shitpile |

---

## 4. Tracks and backlog (PO-*)

Stable IDs for `todo-deferred.md` §2.11. Owner packages listed; contracts changes only when cross-boundary.

### Track A — Daily-path polish (P0)

| ID | Item | Owner | Exit criteria |
|----|------|-------|---------------|
| **PO-TRUST-01** | List project-remembered permissions | `project`, host, contracts if needed | `project/permission-list` or extend project record API; Desktop Settings shows rows |
| **PO-TRUST-02** | Revoke remembered permission | same | revoke one host/action; next tool asks again |
| **PO-TRUST-03** | Trust UX copy | desktop | Deny trust = host-log info not error; re-open trust path discoverable |
| **PO-UX-01** | Adopt `@piwin/ui-kit` EmptyState across panels | desktop, ui-kit | Skills/MCP/Memory/Automation/Git empty states share component |
| **PO-UX-02** | Adopt Spinner for panel loading | desktop, ui-kit | No bare `Loading…` as only treatment in main panels |
| **PO-UX-03** | Session list empty/archive empty polish | desktop | Distinct copy + CTA for no agents / no archived / no search hits |
| **PO-UX-04** | Notification coverage audit | desktop | Export / install skill / MCP start-stop success|fail toast where user expects |
| **PO-SESS-01** | Archive/delete/duplicate micro-UX | desktop, session | After duplicate: select new session; after archive: clear active if needed (already partial — close gaps) |
| **PO-SESS-02** | Destructive confirm consistency | desktop | Archive soft; permanent delete strong confirm only |
| **PO-A11Y-01** | Focus / Escape chains e2e | desktop e2e | Settings close, permission Escape, session menu dismiss, rename dialog focus |

### Track B — Content + docs (P0 parallel)

| ID | Item | Owner | Exit criteria |
|----|------|-------|---------------|
| **PO-SKILL-01** | Bundled skill: `systematic-debugging` | skills/ | SKILL.md valid; ensure-bundled installs |
| **PO-SKILL-02** | Bundled skill: `writing-plans` | skills/ | same |
| **PO-SKILL-03** | Bundled skill: `executing-plans` | skills/ | same |
| **PO-SKILL-04** | Bundled skill: `verification-before-completion` | skills/ | same |
| **PO-SKILL-05** | Bundled skill: `requesting-code-review` | skills/ | same |
| **PO-SKILL-06** | Bundled skill: `using-git-worktrees` | skills/ | same |
| **PO-SKILL-07** | Optional: AGENTS.md / create-rule helpers | skills/ | thin or defer with note |
| **PO-DOC-01** | Sync `todo-deferred` CE rows to reality | docs | MEM/PROC etc not stale Queued |
| **PO-DOC-02** | Keep `product-status.md` current | docs | update each PO slice merge |
| **PO-DOC-03** | README points to doctor + product-status | root | one screen of truth for contributors |
| **PO-DOC-04** | architecture.md: packages + RPC/PTY honesty | docs | memory/process/automation + ADR 0011/0013 |

### Track C — Half-built surfaces (P1)

| ID | Item | Owner | Exit criteria |
|----|------|-------|---------------|
| **PO-AUTO-01** | Hooks: post-event only, last-run/last-error in UI | automation, host, desktop | Settings list shows last status; disabled when automation off |
| **PO-AUTO-02** | Cron: run history + “host must be running” banner | automation, host, desktop | runs/ readable; no claim of daemon |
| **PO-AUTO-03** | Todo: model tool **or** experimental label | host, desktop | If not wired, UI says not available; no fake checklist |
| **PO-AUTO-04** | CLI: `piwin cron list` minimal | cli | read-only ops parity light |
| **PO-SUB-01** | Sub-agent mode chip (readonly \| worktree) | desktop, contracts if needed | visible on child row |
| **PO-SUB-02** | Worktree path display + open affordance | desktop | path string; optional reveal |
| **PO-SUB-03** | Merge failure guidance | desktop | actionable error, not silent |
| **PO-HUB-01** | Skill install progress + cancel residual | marketplace, desktop | progress events or honest spinner + error |
| **PO-HUB-02** | MCP registry draft → configured success path | mcp, desktop | e2e: draft install appears in configured list (partially exists — harden) |
| **PO-OBS-01** | Usage chip + compaction banner density | desktop | no invented %; empty = unknown |

### Track D — Terminal decision (P2, spike-gated)

| ID | Item | Owner | Exit criteria |
|----|------|-------|---------------|
| **PO-PTY-00** | **Spike**: Tauri PTY spawn + bytes + kill on macOS | desktop/src-tauri | written spike note: go / no-go + crate/plugin choice |
| **PO-PTY-01** | contracts/capabilities flip path | contracts, host status | `pty:true` only when real path live |
| **PO-PTY-02** | xterm.js + fit + resize | desktop | scrollback, copy, resize |
| **PO-PTY-03** | Trust gate + dispose on project close | desktop, tauri | untrusted denied; no orphans |
| **PO-PTY-04** | Shell preview fallback retained | desktop | if spike fails, freeze wording forever in status docs |

### Track E — Explicit residual (not in P0–P1)

| ID | Item | Policy |
|----|------|--------|
| PO-RES-01 | D-HOST-01b RPC worker isolation | honesty only; separate program |
| PO-RES-02 | W4 gateway/tunnel | future ADR |
| PO-RES-03 | Pi JSONL tree UI | residual D-M2-01b |
| PO-RES-04 | Windows keychain | residual D-M2-04b |
| PO-RES-05 | Desktop signing/notarization | residual D-ENG-03b |

---

## 5. Architecture rules (non-negotiable)

1. **UI never imports Pi**; only `@piwin/*` + host IPC.
2. **New cross-boundary types** start in `@piwin/contracts`.
3. **PermissionPolicy remains single policy kernel**; hooks never replace it (L3).
4. **PTY I/O does not go through Node host JSONL** when Tauri PTY ships (ADR 0013).
5. **Trust gates** tools and shell; media under `~/.piwin/media/`.
6. **One config root** `~/.piwin`.
7. **CLI parity**: each Desktop-facing ops surface has list/status CLI or documented intentional degradation.
8. **No god modules**: new UI in focused files/hooks; host commands stay in `commands/*`.

### Package ownership

| Change | Touch |
|--------|-------|
| Permission remember list/revoke | `project`, `contracts`, `agent-host`, desktop Settings, optional CLI |
| Empty/loading | `ui-kit`, `apps/desktop` panels |
| Bundled skills | `skills/` + ensure-bundled |
| Automation honesty | `automation`, host automation commands, desktop AutomationPanel |
| Sub-agent labels | desktop SubAgentPanel, maybe session index fields already present |
| PTY | `apps/desktop/src-tauri`, desktop TerminalDock, ADR 0013, capabilities |

---

## 6. Design specs (feature-level)

### 6.1 Permission remember manager (PO-TRUST-*)

**Problem:** Users can Allow for project; cannot see or undo.

**Model (proposal — refine in contracts when implementing):**

```ts
// Conceptual — implement as contracts types when coding
type RememberedPermission = {
  projectPath: string;
  action: string;       // e.g. network:web_search, mcp:tool-call, bash:…
  key: string;          // stable fingerprint (host, serverId, etc.)
  createdAt: string;
};
```

**IPC (additive):**

- `project/permissions-list` `{ projectPath }` → `{ permissions: RememberedPermission[] }`
- `project/permissions-revoke` `{ projectPath, key }` → `{ ok: true }`

**UI:** Settings → Workspace (or Security) → “Remembered tool permissions” list + Revoke.

**Tests:** unit on store; host-runtime list/revoke; desktop e2e: allow-for-project → appear → revoke → tool asks again (mock path).

### 6.2 Empty / loading system (PO-UX-01/02)

**Adopt existing:**

- `@piwin/ui-kit` `EmptyState`, `Spinner`
- Desktop CSS classes already present for empty-state

**Panels to migrate:** Skills, MCP, Memory, Automation, Extensions, Git empty, sessions empty (sidebar can stay specialized but share copy patterns).

**Rule:** loading = Spinner + short label; empty = title + body + optional primary CTA.

### 6.3 Bundled skills pack (PO-SKILL-*)

**Install path:** existing ensure-bundled under `~/.piwin/skills` (or repo `skills/` shipped and copied).

**Minimum SKILL.md quality bar:**

- YAML frontmatter `name` + `description`
- 1-screen procedure (steps the agent should follow)
- No executable payloads
- ASCII default

**Do not:** copy entire Anthropic/Cursor skill markets; license check if adapting text.

### 6.4 Automation honesty (PO-AUTO-*)

| Surface | Ship | Do not ship |
|---------|------|-------------|
| Hooks | post-event arm + last-run | PreToolUse block, matcher DSL |
| Cron | list/upsert/run + history + banner | background daemon claim |
| Todo | tool+panel **or** experimental | silent empty checklist |

**User priority:** hooks low — time-box AUTO-01 to 0.5–1 day max polish.

### 6.5 Sub-agent visibility (PO-SUB-*)

Use existing index fields: `subagentMode`, `worktreePath`, status.

**UI:** chip on child rows; path muted; merge errors via toast + host-log.

### 6.6 Tauri PTY (PO-PTY-*)

**Gate:** PO-PTY-00 spike note under `docs/notes/pty-tauri-spike.md`:

- Can spawn shell with cwd = trusted project
- Stream stdout/stderr or PTY data to UI
- Kill on window/project close
- Packaging risk notes

**If go:** implement PO-PTY-01..03; flip `capabilities.pty`.  
**If no-go:** document permanent Shell preview; set PO-PTY-04 done; leave `pty:false`.

---

## 7. Delivery plan (slices)

Implement as vertical slices. Each slice: typecheck + tests + update product-status if user-visible.

| Slice | Track IDs | Deliverable | Est. |
|-------|-----------|-------------|------|
| **S0** | PO-DOC-01..03 | Backlog/CE sync + README pointer + product-status refresh | 0.5d |
| **S1** | PO-TRUST-01..03 | Permission list/revoke + Settings UI + tests | 1–2d |
| **S2** | PO-UX-01..04, PO-SESS-01..02 | Empty/Spinner adoption + notification audit + session micro-UX | 1–2d |
| **S3** | PO-SKILL-01..06 | Bundled skills thin pack + ensure-bundled | 1d |
| **S4** | PO-A11Y-01 | Focus/Escape e2e | 0.5–1d |
| **S5** | PO-AUTO-01..04 | Automation honesty (time-boxed) | 1d |
| **S6** | PO-SUB-01..03, PO-OBS-01 | Sub-agent chips + usage/compaction polish | 1d |
| **S7** | PO-HUB-01..02 | Hub install path harden | 1d |
| **S8** | PO-PTY-00 | Tauri PTY spike note only | 1–2d |
| **S9** | PO-PTY-01..04 | Full PTY **or** permanent preview freeze | 3–5d if go |

**Order rule:** S0→S4 before S5–S7. S8 before any S9 full PTY. Do not interleave S9 with S1–S3.

---

## 8. Acceptance (program-level)

1. User can **list and revoke** project-remembered tool permissions without editing JSON.
2. Main panels use **shared EmptyState/Spinner** patterns; session archive/active empty copy is clear.
3. **≥6 new bundled skills** install via ensure-bundled; Skills panel lists them.
4. Automation surfaces **do not claim** capabilities they lack; hooks stay post-event only.
5. Sub-agent list shows **isolation mode** and worktree path when present.
6. `product-status.md` + doctor capability matrix agree with runtime flags.
7. Terminal is either **real Tauri PTY + xterm** or **permanently labeled Shell preview** after spike.
8. `pnpm typecheck` + touched package tests + `pnpm e2e:desktop` green.
9. No apps → Pi imports; no new circular package deps.

---

## 9. Test policy

| Change | Required |
|--------|----------|
| Permission store/list/revoke | unit + host-runtime |
| EmptyState adoption | e2e spot-check critical empty (sessions / chat) |
| Bundled skills | ensure-bundled path unit or CLI smoke |
| Automation last-run | host unit for gate + one UI e2e optional |
| PTY spike | manual note + optional native smoke later |
| A11y | Playwright keyboard cases |

Avoid low-value tests that restate JSX structure.

---

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Remembered permission key schema unstable | version field; revoke-all per project escape hatch |
| Skill content quality debates | thin templates + L8; expand later |
| Automation scope creep | L6 time-box; hooks not product push |
| PTY packaging kills schedule | L7 spike gate; Shell preview OK |
| Structure regressions while polishing | small vertical slices; no drive-by host rewrites |

---

## 11. Relationship to other programs

| Program | Relation |
|---------|----------|
| Product Depth (PD-*) | Mostly **done/partial**; PO-* continues product residual |
| CE W1–W4 | Capability already partially shipped; PO finishes honesty, not more CE surface |
| Desktop UI stabilization | Consume remaining a11y e2e; no redesign |
| ADR 0012 RPC isolation | Out of PO; honesty only |
| ADR 0013 Tauri PTY | PO Track D executes spike + optional ship |

---

## 12. Done definition for a PO slice

1. Code merged in owning packages only.  
2. Public exports intentional.  
3. Tests per §9.  
4. `todo-deferred` PO row status updated.  
5. `product-status.md` row color updated if user-visible.  
6. CLI parity or one-line intentional degradation in slice notes.

---

## 13. Next action

1. Accept this spec (or amend L5–L8).  
2. Add **§2.11 Product Optimization (PO-*)** to `docs/todo-deferred.md` (rows from §4).  
3. Start **S0 → S1** (docs sync + permission remember manager).

---

## 14. References

- [`docs/prd.md`](../prd.md)  
- [`docs/architecture.md`](../architecture.md)  
- [`docs/product-status.md`](../product-status.md)  
- [`docs/specs/product-depth-competitive-alignment.md`](./product-depth-competitive-alignment.md)  
- [`docs/adr/0011-rpc-sdk-fallback-and-prompts.md`](../adr/0011-rpc-sdk-fallback-and-prompts.md)  
- [`docs/adr/0012-rpc-worker-isolation.md`](../adr/0012-rpc-worker-isolation.md)  
- [`docs/adr/0013-pty-tauri.md`](../adr/0013-pty-tauri.md)  
- Cursor Agents IA · Claude Code hooks (post-event subset) · xterm.js + Tauri (industry terminal)  

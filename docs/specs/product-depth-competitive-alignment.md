# Spec — Product Depth & Competitive Alignment

| Field | Value |
|-------|-------|
| Status | **Mostly complete** — residual work continues under Product Optimization |
| Date | 2026-07-21 |
| Trigger | Full-project roughness review: breadth-first shell feels unfinished |
| Successor | [`product-optimization-program.md`](./product-optimization-program.md) (PO-*) |
| Related | [`desktop-ui-interaction-stabilization-plan.md`](./desktop-ui-interaction-stabilization-plan.md), [`program-capability-expansion.md`](./program-capability-expansion.md), [`todo-deferred.md`](../todo-deferred.md), [`adr/0013-pty-tauri.md`](../adr/0013-pty-tauri.md), PRD AW-*, CE-* |
| Rule | Prefer **copy open patterns / align UX information architecture**; never fork Pi; never import Pi from apps |

---

## 0. One-liner

把 piwin 从「功能墙」收敛成 **可用的 Agent Shell**：补齐主路径深度与交互诚实性；同类 coding agent 里能抄的协议/栈/信息架构就抄，闭源 UI 只对齐交互，不抄实现。

---

## 1. Why this doc exists

Capability Expansion (W1–W3) 与 Extensions 通道已把表面拉得很宽：Memory、Process、Pin、Sub-agent、PTY 雏形、Hub、Cron/Hooks 骨架都在。

体感问题不是「还缺十个新域」，而是：

1. **主路径会话生命周期不闭环**（rename / archive / fork-light 等）
2. **半完成能力挂在 UI 上**（Terminal 实为行式 shell；RPC 实为 SDK fallback；hooks/todo 接线不全）
3. **反馈与结构粗糙**（App/host-runtime 上帝模块、无 toast 队列、空态/加载不统一）
4. **内容与文档漂移**（bundled skills 少于 PRD；backlog 状态过期）

本文件定义：**要实现什么** + **竞品/开源怎么做** + **我们抄什么、对齐什么、明确不抄什么** + **已锁定决策**。

---

## 2. Locked decisions (2026-07-21)

| # | Question | Decision | Implication |
|---|----------|----------|-------------|
| **L1** | Delete vs archive | **Archive is the default lifecycle action** (soft hide). Hard delete is secondary (confirm + optional empty archive). | Session index gains `archivedAt` / `isArchived`; list defaults exclude archived; UI has Archive + “Show archived” + permanent delete from archive view. |
| **L2** | Fork | **Historical decision:** fork-light shipped as whole-session `session/duplicate`. **Superseded for new product work on 2026-08-04:** Duplicate remains an independent complete copy; response-level Fork creates a linked transcript prefix. | See [`session-fork-product-adaptation.md`](./session-fork-product-adaptation.md). Pi multi-leaf JSONL remains residual D-M2-01b. |
| **L3** | Hooks PreToolUse | **Post-event hooks only** for v1 depth. User expects low personal use — ship minimal, correct wiring + last-run visibility; do not build Claude-full 12-event surface. | Map `tool/end`, `message/end`, session settle only. No PreToolUse block path competing with PermissionPolicy. |
| **L4** | PTY host stack | **Tauri-side PTY** (Rust / official or curated Tauri plugin), not Node `node-pty` as primary. | Desktop renderer ↔ Tauri command/events ↔ PTY; Node host may still own trust checks / session association via IPC bridge. See ADR 0013. |

These four override earlier “recommendation defaults” in drafts and in W2 “node-pty first” language for the product path.

---

## 3. Scope

### 3.1 In scope (this program)

| Track | 目标 |
|-------|------|
| **A. Session product** | Rename · **Archive** · hard-delete-from-archive · whole-session Duplicate (historically fork-light) · context menu · pin section. Response-level Fork is now specified under SF-*. |
| **B. Truthful capabilities** | Shell vs PTY 文案；doctor/UI 能力矩阵；hooks/todo/cron 接线完成或明确 disabled |
| **C. Shell structure** | 拆 `App.tsx` / `host-runtime` / `host-client`；ui-kit 最小原语 |
| **D. Feedback UX** | Notification queue、App ErrorBoundary、统一 Empty/Loading/Error |
| **E. Content + docs** | 默认 skills 补齐；backlog/PRD 状态同步 |
| **F. Terminal depth** | **Tauri PTY** + `xterm.js`；完成前 UI 诚实称 Shell |
| **G. Automation depth** | **Post-event hooks only**；Todo 工具 + Execution 面板；Cron 运行史（hooks 做薄） |

### 3.2 Out of scope (do not start here)

| Item | Why |
|------|-----|
| W4 personal gateway / tunnel | 扩远程面，不解决「糙」 |
| Cloud multi-tenant / hosted registry | 违反 private-first |
| Full Pi JSONL multi-leaf tree UI | ADR 0009 已选 product shell；另轨 |
| True RPC worker isolation (D-HOST-01b) | 并行硬轨；本程序只要求 **诚实标注** |
| Electron / 第二 agent 内核 | AGENTS.md 禁止 |
| 复杂 git DAG / force-push | 非主路径去糙 |
| Claude-style PreToolUse hook blocking | **Locked L3: not for v1** |
| Node `node-pty` as product PTY path | **Locked L4: Tauri PTY** |

---

## 4. Competitive landscape (what we studied)

Sources: product docs & public writeups (Cursor Agents / pin UX, Claude Code hooks & sessions, Codex/agent cloud positioning, industry terminal stack, existing piwin CE specs). Open-source patterns from common agent shells (Cline/Roo-class tool-approval UIs, VS Code terminal stack, MCP registry).

### 4.1 Positioning map

| Product | Form factor | What to steal | What not to steal |
|---------|-------------|---------------|-------------------|
| **Cursor** (Agents Window / Glass) | GUI agent hub in IDE | Session list IA: pin section, context menu (Pin / Rename / Fork / **Archive**), parallel agent roster, worktree isolation narrative | Closed UI chrome, cloud agent env, Design Mode, multi-LLM race as v1 |
| **Claude Code** | Terminal-first CLI + VS Code ext | **Hooks model** (lifecycle side effects); session resume culture | Full 12-event surface day one; PreToolUse dual policy kernel (**we skip PreToolUse**) |
| **OpenAI Codex** | Cloud/async agents + desktop variants | Long-job isolation story; PR-oriented completion | Cloud-first runtime; second kernel |
| **Cline / Roo Code class** | VS Code extension agents | Tool card + approve/deny UX, checkpoint/resume mental model, MCP panel shape | Forking their monorepo; their tool executor |
| **Continue.dev** | Open IDE assistant | Context providers as pluggable units; local config honesty | Their chat kernel as second host |
| **Aider** | Git-centric CLI | Diff/commit as first-class agent outcome | Forcing git-only UX |
| **VS Code Terminal** | Editor platform | **xterm.js in UI**; OS PTY behind host process | Shipping a fake "Terminal" without PTY |
| **Tauri ecosystem** | Native shell | **PTY via Rust/plugin** (our L4); FS/dialog bridges | Putting agent kernel in Rust |
| **LiveAgent** (parity target in CE) | Full local agent product | Capability checklist (memory, process, hubs, cron) | Fork monorepo / Rust tool host |
| **Pi** | Our kernel | Extensions, ResourceLoader, customTools, FileOperations, contextUsage | Product UI inside Pi |

### 4.2 Cross-product pattern summary

```text
┌─────────────────────────────────────────────────────────────┐
│ Session list = first-class product object                    │
│   pin · rename · archive · search · fork/duplicate           │
│   context menu (not only hover icons)                        │
├─────────────────────────────────────────────────────────────┤
│ Agent run = streaming transcript + tool cards + permissions  │
│   host-owned policy · UI only decides remember/ask           │
├─────────────────────────────────────────────────────────────┤
│ Side surfaces = Skills / MCP / Terminal / Git / Settings     │
│   install hubs · health · truthful capability badges         │
├─────────────────────────────────────────────────────────────┤
│ Automation = thin post-event hooks + cron (scheduler)        │
│   never run shell from renderer; hooks optional/low priority │
├─────────────────────────────────────────────────────────────┤
│ Terminal = real PTY emulator (Tauri) + xterm renderer        │
│   OR explicitly labeled shell until that ships               │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. What to implement (concrete backlog)

IDs are stable for `todo-deferred.md`. Prefix **PD-** = Product Depth.

### Track A — Session product (PRD AW-06) · Locked L1 + L2

| ID | Item | Priority | Exit criteria |
|----|------|----------|---------------|
| PD-SESS-01 | `session/rename` IPC + index field | P0 | Name persists across restart; list + titlebar update |
| PD-SESS-02 | `session/archive` + `session/unarchive` | P0 | Default list hides archived; archived view can restore |
| PD-SESS-03 | `session/delete` (permanent, from archive or explicit) | P0 | Confirm dialog; removes index + product transcript; only after archive or with strong confirm |
| PD-SESS-04 | Session row **context menu** | P0 | Pin · Rename · Export · **Archive** · Duplicate · (Delete permanent when archived) |
| PD-SESS-05 | `session/duplicate` (historically called fork-light) | P1 | New session id; copies the complete product transcript; independent of Pi JSONL tree. It is no longer the product meaning of response-level Fork; see SF-* spec. |
| PD-SESS-06 | Pinned section UI | P1 | Pinned block above recency groups (Cursor pattern); archived never mixed into pin without unarchive |
| PD-SESS-07 | Show archived toggle | P1 | Sidebar filter; empty archived state |

**Industry align (Cursor):** right-click → Pin, Rename, Fork, Archive.  
**piwin map:** product transcript + session index (ADR 0009).  
**Historical note:** the 2026-07-21 slice used Duplicate as a temporary
fork-light interaction. The approved SF-* design now keeps Duplicate and
response-level Fork distinct while still avoiding Pi multi-leaf coupling.

**Archive policy (L1):**

```text
Active list  →  Archive  →  Archived list  →  Restore | Delete permanently
Delete from active list: optional shortcut that archives first OR confirms permanent
  (prefer: Archive only in primary menu; permanent delete only under archived / destructive confirm)
```

### Track B — Truthful capabilities

| ID | Item | Priority | Exit criteria |
|----|------|----------|---------------|
| PD-TRUE-01 | Shell dock naming until Tauri PTY live | P0 | UI says **Shell** / “Shell preview” while `capabilities.pty !== true` (real) |
| PD-TRUE-02 | Doctor + Settings capability matrix | P0 | Lists customTools, productTranscript, mcpLifecycle, process, memory, pty, rpcIsolation, hooks, cron |
| PD-TRUE-03 | RPC isolation badge | P0 | When SDK fallback: “RPC mode: SDK backend (no process isolation)” |
| PD-TRUE-04 | Partial surfaces honesty | P0 | hooks: post-event only + “optional”; todo: wired or disabled label; cron: runs history or experimental |

### Track C — Structure (anti-shitpile)

| ID | Item | Priority | Exit criteria |
|----|------|----------|---------------|
| PD-STR-01 | Extract `ProjectSessionSidebar` from App | P0 | App loses ≥400 lines; e2e still green |
| PD-STR-02 | Extract `ChatTranscript` + `ComposerBar` | P0 | Prompt/abort/media stay in App or thin hooks only |
| PD-STR-03 | Split `HostRuntime` command handlers by domain | P0 | `session-commands.ts`, `memory-commands.ts`, … runtime ≤ orchestration |
| PD-STR-04 | Split `host-client` transport / mock / commands | P1 | Mock mode isolated |
| PD-STR-05 | ui-kit primitives | P1 | EmptyState, Banner, Toast region, TextField, ConfirmDialog, Spinner |
| PD-STR-06 | CSS split by domain | P2 | `styles/` rail/sidebar/chat/settings; tokens one place |

### Track D — Feedback UX

| ID | Item | Priority | Exit criteria |
|----|------|----------|---------------|
| PD-UX-01 | Notification queue (info/success/error/warning) | P0 | Not a single overwritten error string |
| PD-UX-02 | App-level React ErrorBoundary | P0 | Crash shows recovery UI + open host log |
| PD-UX-03 | Unified Empty/Loading/Error in panels | P1 | Skills/MCP/Memory/Automation/Git share components |
| PD-UX-04 | Focus / Escape chains e2e | P1 | Settings, permission, menus |
| PD-UX-05 | Permission remember manager | P1 | List + revoke project-remembered permissions |

### Track E — Content + docs

| ID | Item | Priority | Exit criteria |
|----|------|----------|---------------|
| PD-DOC-01 | Sync `todo-deferred.md` CE rows to reality | P0 | MEM/PROC/etc status match code |
| PD-DOC-02 | One-page `product-status.md` green/yellow/red | P0 | Main paths scored |
| PD-DOC-03 | Bundled skills pack (PRD baseline) | P1 | systematic-debugging, writing-plans, executing-plans, verification-before-completion, requesting-code-review, using-git-worktrees (thin SKILL.md OK) |
| PD-DOC-04 | Architecture + memory/process/automation + Tauri PTY | P1 | architecture.md updated |

### Track F — Real terminal via Tauri · Locked L4

| ID | Item | Priority | Exit criteria |
|----|------|----------|---------------|
| PD-PTY-01 | ADR 0013 accepted + spike: Tauri PTY plugin/crate works on macOS | P0 | Can spawn shell, stream output, send input |
| PD-PTY-02 | contracts: keep/refine `pty/*`; host may proxy trust only | P0 | Untrusted project denied; cwd = project root |
| PD-PTY-03 | Desktop: `xterm.js` + fit addon talks to **Tauri** events/commands | P1 | Resize, scrollback, copy |
| PD-PTY-04 | Dispose on project close / window destroy | P1 | No orphan shell processes |
| PD-PTY-05 | capabilities.pty truthful | P1 | false until real PTY path green |
| PD-PTY-06 | Agent-driven PTY | P2 | Optional later; ManagedProcess remains non-interactive long jobs |

**Industry stack (aligned to L4):**

```text
Renderer (xterm.js)
    │ Tauri invoke / listen (not Node child_process)
    ▼
Tauri Rust (PTY plugin / portable-pty / similar)
    │
    ▼
OS PTY + login shell / project cwd

Optional: Node HostRuntime only for trust/session bookkeeping
  (desktop asks host “is project trusted?” then opens Tauri PTY)
```

**Do not** make Node `node-pty` the product path. Existing piped shell `PtyHost` stays interim Shell preview until Tauri path replaces it.

### Track G — Automation depth · Locked L3 (thin)

User signal: **hooks are low-priority personal usage**. Implement correctness, not a second product.

| ID | Item | Priority | Exit criteria |
|----|------|----------|---------------|
| PD-AUTO-01 | Post-event arm on AgentEvent only | P1 | tool/end, message/end, session settle; gated by automation.hooksEnabled |
| PD-AUTO-02 | No PreToolUse / block path | P0 (constraint) | Code + docs forbid PreToolUse hooks in v1 |
| PD-AUTO-03 | Last-run / last-error on hook rows | P2 | Minimal status; no fancy matcher DSL |
| PD-AUTO-04 | Session todo tool + Execution panel | P1 | More user-visible than hooks; model todo_set/get |
| PD-AUTO-05 | Cron run history | P1 | runs/ visible when cron enabled |
| PD-AUTO-06 | CLI automation ops | P2 | Optional; not blocking desktop |

**Claude align (borrow lightly):** post-tool / stop-style side effects only.  
**Do not** port PreToolUse allow/deny (PermissionPolicy already owns that).

### Track H — Sub-agent / worktree polish

| ID | Item | Priority | Exit criteria |
|----|------|----------|---------------|
| PD-SUB-01 | Worktree path + status chip | P1 | Isolation root visible |
| PD-SUB-02 | Concurrency limit UI | P2 | Batch max N visible |
| PD-SUB-03 | Readonly vs worktree labels | P1 | Honest tool surface |

---

## 6. Feature-by-feature: industry → piwin → decision

### 6.1 Session lifecycle

| Aspect | Cursor | Claude Code | **piwin (locked)** |
|--------|--------|-------------|---------------------|
| List object | Agents panel | CLI sessions | Product session index |
| Pin | Context menu + section | — | Keep pin API + pinned UI section |
| Rename | Context menu | community | **Add session/rename** |
| Archive | Archive prior chats | delete files | **Primary: archive (L1)** |
| Hard delete | exists | yes | From archive + confirm |
| Fork | Fork chat | resume styles | **Duplicate product transcript (L2)** |
| Search | panel search | — | Keep session/search |

### 6.2 Streaming chat + tools

Keep ToolCallCard, abort truthfulness, product truncate-resend, PlanPanel.  
Copy: density + permission modal. Don’t copy vendor tool runners.

### 6.3 Permissions & trust

Host PermissionPolicy remains single source of truth.  
Hooks **do not** become a second policy kernel (L3).

### 6.4 Memory / process / MCP / skills

Unchanged from CE: `@piwin/memory`, `@piwin/process`, mcp.json shape, Agent Skills format. Polish honesty and UX only.

### 6.5 Terminal

| Was (W2 draft) | Now (L4) |
|----------------|----------|
| node-pty in Node host first | **Tauri PTY first** |
| xterm in desktop | still xterm in desktop |
| Activity vs Terminal tabs | Activity = tool logs; Terminal = PTY when ready else Shell preview |

### 6.6 Hooks & cron

| Was | Now (L3 + user priority) |
|-----|--------------------------|
| Rich Claude 12-event surface | **Post-event subset only** |
| PreToolUse block | **Out of scope** |
| Heavy hooks investment | **Thin wiring**; invest more in session/UX/PTY |

---

## 7. Recommended architecture

```text
apps/desktop
  components/          # sidebar, transcript, composer (extracted)
  notifications/
  terminal/            # xterm ↔ Tauri PTY bridge (not Node spawn)
  host-client/         # transport | mock | api  (host for agent, not PTY bytes)
       │ HostCommand / HostPush          │ Tauri commands (pty)
       ▼                                 ▼
packages/agent-host                 apps/desktop/src-tauri
  host-runtime + commands/*          pty module / plugin
  adapters sdk|rpc                   portable-pty / shell
       │
packages/* domain · contracts
```

**Invariant (unchanged):** apps ↛ Pi packages; only agent-host imports Pi; automation shell never from renderer.

---

## 8. Copy / borrow / build matrix

| Capability | Copy (open) | Borrow (IA only) | Build (piwin-specific) |
|------------|-------------|------------------|------------------------|
| mcp.json shape | Cursor/Claude schema | form UX | lifecycle manager |
| Agent Skills | agentskills format | hub tabs | `~/.piwin` + ResourceLoader |
| Terminal UI | xterm.js | dock placement | **Tauri PTY** + trust gate |
| Hooks | post-event idea only | settings layout | thin AgentEvent arm |
| Session menu | Cursor pin/rename/fork/**archive** | — | product index + archive flags |
| Tool approve | Cline-like cards | — | host permission events |
| Memory | — | panels | `@piwin/memory` |
| Sub-agent | git worktree | Cursor worktree story | depth-1 + apply policies |
| Artifact | openwebui_m pure TS | — | already |

---

## 9. Delivery slices (execution order)

| Slice | Tracks | Deliverable |
|-------|--------|-------------|
| **S0** | E | Docs/backlog truth; this doc + ADR 0013 accepted |
| **S1** | A | Rename + Archive + context menu + permanent delete from archive |
| **S2** | B | Capability honesty + Shell wording |
| **S3** | D | Notification queue + ErrorBoundary |
| **S4** | C | Sidebar + transcript/composer extract |
| **S5** | A | Duplicate (fork-light) + pinned section + show archived |
| **S6** | C | HostRuntime command split |
| **S7** | F | Tauri PTY spike → xterm integration (`PD-PTY-*`) |
| **S8** | G | Thin post-event hooks + todo panel (hooks not a product push) |
| **S9** | E/H/D | Bundled skills; sub-agent labels; remember manager; a11y e2e |

**Order rule:** Session archive lifecycle and structure before Tauri PTY packaging rabbit hole. Hooks last among depth items.

---

## 10. Acceptance (program-level)

1. User can **rename, pin, export, archive, restore, permanently delete, duplicate** sessions from context menu.
2. Default list does **not** show archived sessions; archived view is explicit.
3. No UI label claims a capability `capabilities.*` says false.
4. `App.tsx` / `host-runtime.ts` modularized (target each &lt; ~1500 lines or domain-split).
5. Failures are dismissible notifications; renderer crash is recoverable.
6. Hooks are post-event only, optional, and do not block tools; todo/cron either work or labeled.
7. Terminal is either **Tauri PTY + xterm** or permanently named Shell preview with `capabilities.pty` honest.
8. PRD default skills exist as bundled content (thin OK).
9. `pnpm typecheck` + package tests + `pnpm e2e:desktop` green; Tauri PTY has at least a native smoke note.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Tauri PTY packaging / plugin maintenance | Early S7 spike (PD-PTY-01); keep Shell preview fallback; document plugin choice in ADR 0013 |
| Archive vs delete user confusion | Menu primary = Archive; permanent delete only with typed confirm or from archived view |
| Duplicate session disk bloat | Cap optional; document; no auto-duplicate of media binaries beyond refs |
| Scope creep into PreToolUse hooks | L3 locked; reject PR that adds PreToolUse without new ADR |
| Scope creep into W4/gateway | Out of scope list in review |

---

## 12. References

### Internal

- [`docs/prd.md`](../prd.md)  
- [`docs/architecture.md`](../architecture.md)  
- [`docs/todo-deferred.md`](../todo-deferred.md)  
- [`docs/specs/desktop-ui-interaction-stabilization-plan.md`](./desktop-ui-interaction-stabilization-plan.md)  
- [`docs/specs/program-capability-expansion.md`](./program-capability-expansion.md)  
- [`docs/specs/w1-memory-process-chat.md`](./w1-memory-process-chat.md)  
- [`docs/specs/w2-subagent-compaction-pty.md`](./w2-subagent-compaction-pty.md) — **PTY path superseded by L4 / ADR 0013 for product**  
- [`docs/specs/w3-marketplace-automation.md`](./w3-marketplace-automation.md)  
- [`docs/adr/0013-pty-tauri.md`](../adr/0013-pty-tauri.md)  
- ADR 0001 (Tauri), 0008–0012  

### External (public patterns)

- Cursor pin / agents context menu: https://jonesrussell.github.io/blog/cursor-pin-agent-chats/  
- Cursor 3 agent hub: https://codepick.dev/en/guides/cursor-3-new-features/  
- Claude Code Hooks (reference only; we take post-event subset): https://code.claude.com/docs/en/hooks  
- xterm.js: https://github.com/xtermjs/xterm.js  
- Tauri 2: https://v2.tauri.app/  
- MCP TS SDK / Agent Skills / Pi docs — see m3-m4-opensource-notes  

---

## 13. Next action

1. ~~Resolve open questions~~ → **locked in §2**.  
2. Land ADR 0013 (Tauri PTY).  
3. Add **PD-*** rows into `docs/todo-deferred.md` as Active.  
4. Start **S0 → S1** (docs truth + rename/archive menu).

When implementing: contracts-first → session package → host commands → desktop UI → tests.

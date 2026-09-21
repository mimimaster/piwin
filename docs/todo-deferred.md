# piwin Canonical Backlog

| Field | Value |
|-------|-------|
| Status | Living execution backlog |
| Updated | 2026-08-10 |
| Roadmap | [`v1-completion-roadmap.md`](./specs/v1-completion-roadmap.md) |
| Rule | This is the **only** task backlog. Specs explain design and acceptance; this file tracks execution state. |

> **状态约定：** Active / Queued / Future / Done archive。  
> **有意未做 / 未实现部分必须写进本文件（含 Why deferred）**，禁止只口头遗漏。

---

## 0. Current execution order

1. **P0–P5 product cores** — done (host, media/web/skills/MCP, Artifact, Git, Theme, Pet).
2. **P6 main-path completion** — **Done 2026-07-20** (M1–M5 tracks in plan).
3. **Pi Extensions channel Slice 1** — **Done 2026-07-21** (list/enable + ResourceLoader + path-guard); see [`docs/plans/2026-07-21-pi-extensions-channel.md`](plans/2026-07-21-pi-extensions-channel.md) · ADR 0010.
4. Remaining work is **polish / residual** — executable plan: [`docs/plans/2026-07-20-residual-execution.md`](plans/2026-07-20-residual-execution.md)  
   - **R1 first:** MCP tool-remember, MCP watchdog, host-log, theme remount, artifact expand  
   - **R2:** Windows keychain, Tauri UI e2e, signing  
   - **R3 spikes:** Pi JSONL tree, RPC custom tools, MCP SSE  
   - **R4 later:** sub-agent, git DAG, content packs  
   - **R5 extensions follow-on:** mostly done (D-EXT-01..03,05..07); residual D-EXT-04 UI bridge; D-HOST-01b is absorbed by Runtime Refactor Phase 3
5. **Settings + Runtime architecture refactor (ordered):** component scaffolding exists, but the production vertical slice is **not complete**. Execute the review-backed completion sequence: immutable session compilation → one Job authority → parent-owned tool authority → production SubagentOrchestrator → compatibility deletion —
   [`docs/plans/2026-08-04-runtime-authority-completion.md`](./plans/2026-08-04-runtime-authority-completion.md) ·
   [`docs/specs/settings-capability-runtime-refactor.md`](./specs/settings-capability-runtime-refactor.md) ·
   [`docs/specs/runtime-refactor.md`](./specs/runtime-refactor.md).
6. **Capability Expansion program (queued):** LiveAgent-class features via Pi ecosystem —  
   [`docs/specs/program-capability-expansion.md`](./specs/program-capability-expansion.md) · W1–W4 `docs/specs/w*.md` · backlog **CE-*** in §2.9.
7. **Product Depth (recommended next for “too rough”):** main-path depth + competitive alignment —  
   [`docs/specs/product-depth-competitive-alignment.md`](./specs/product-depth-competitive-alignment.md) · ADR [`0013-pty-tauri.md`](./adr/0013-pty-tauri.md) · backlog **PD-***.  
   **Historical lock 2026-07-21:** archive-first sessions; the shipped
   fork-light was whole-session Duplicate; post-event hooks only (thin);
   **Tauri PTY** (not node-pty). The 2026-08-04 SF-* spec now separates
   Duplicate from response-level Fork.
8. **Product-Shell Repair (PSR-*) — Active 2026-07-22:** developer-preview desktop shell repair —  
   plan [`docs/plans/2026-07-22-desktop-product-shell-repair.md`](plans/2026-07-22-desktop-product-shell-repair.md).  
   **D1 lock:** remains developer preview; bundled Node/host sidecar distribution is intentionally deferred (not a completed release path).
9. **Product-level Session Fork (SF-*) — Ready for implementation 2026-08-04:** user-triggered response branching, a discoverable response-level Duplicate entry, and lightweight product lineage without coupling v1 to Pi JSONL active-leaf restore —
   spec [`docs/specs/session-fork-product-adaptation.md`](specs/session-fork-product-adaptation.md).

---

## 1. Active / recently completed critical path

| ID | Item | Owner | Notes |
|----|------|-------|-------|
| A-GIT-WRITE | ~~Git mutating ops~~ | `git`, host, desktop | **Done** |
| A-THEME | ~~Theme packages + Desktop~~ | `theme`, host, desktop | **Done** |
| A-PET | ~~Pet packages + Desktop~~ | `pet`, host, desktop | **Done** |
| A-P6-CORE | ~~P6 functional core~~ | host, cli, CI | **Done** — gated bash, doctor, CI |
| A-P6-SEC | ~~Network SSRF + project remember + file picker~~ | tools-web, project, host, desktop | **Done** |
| A-SESSION-RESUME | ~~Session transcript + resume hydrate~~ | session, host, desktop | **Done** — product transcript layer |
| A-MCP-LIFE | ~~MCP health/start/stop lifecycle~~ | `mcp`, host, desktop | **Done 2026-07-20** — manager + IPC + McpPanel |
| A-P6-MAIN | ~~P6 main-path M1–M5~~ | mcp, host, session, project, desktop, cli, docs | **Done 2026-07-20** — plan + ADR 0008/0009 |
| A-RUNTIME-AUTH | Runtime authority completion | contracts, process, host-runtime, agent-host, session, git, CLI, Desktop | **Active** — do not advertise Job, worker tool, or parallel subagent completion until the ordered plan's deletion gates pass. |

---

## 2. Intentionally deferred / unfinished (must not vanish)

### 2.1 Media / Desktop polish

| ID | Item | Why deferred / unfinished | Suggested |
|----|------|---------------------------|-----------|
| D-MED-01 | ~~Tauri media asset scope~~ | Done | done |
| D-MED-02 | ~~Historical attachment hydration~~ | Done via product transcript | done |
| D-MED-03 | ~~File-picker attach~~ | Done | done |
| D-MED-04 | Thumbnail cache / dimensions | optional quality | polish |
| D-MED-05 | Composer paste latency (large images) | Three bottlenecks: (1) `fileToBase64` synchronous `String.fromCharCode` loop blocks main thread on 2MB+ images; (2) first paste with no active session triggers IPC `session/create` round-trip before image processing starts; (3) `media/save` IPC transmits full base64 string. Fix after media/IPC architecture refactor — candidate solutions: Web Worker for base64 encoding, optimistic preview via `URL.createObjectURL` before save, pre-create general session on startup, or Tauri native FS write to bypass JS encoding + IPC serialization entirely. | after architecture refactor |
| D-WEB-01 | ~~Web settings + citations~~ | Done | done |
| D-WEB-02 | ~~Project-remember network~~ | Done | done |
| D-WEB-03 | ~~SSRF depth~~ | Done | done |

### 2.2 Skills / MCP

| ID | Item | Why deferred / unfinished | Suggested |
|----|------|---------------------------|-----------|
| D-SK-01 | ~~Desktop Skill install~~ | Done | done |
| D-SK-02 | Richer bundled skill templates | find/create/web-research present; content expansion later | content |
| D-MCP-01 | ~~MCP form editor~~ | Done | done |
| D-MCP-02 | ~~MCP server health/start/stop lifecycle~~ | **Done 2026-07-20** — `createMcpLifecycleManager` + `mcp/status|start|stop` + Desktop Start/Stop | done |
| D-MCP-02b | ~~Host-owned manager shared with session bridge~~ | **Done 2026-07-20** — HostRuntime + bare createAgentHost own manager | done |
| D-MCP-02c | ~~MCP crash watchdog (exit→error + optional single restart)~~ | **Done 2026-07-20** — `onExit` + `restartOnCrash` (default false, once) | done |
| D-MCP-02d | ~~Project-remember for mcp:connect~~ | **Done 2026-07-20** — `ProjectMcpPolicy.allowedServerIds` | done |
| D-MCP-02d-tool | ~~Server-level tool-call remember~~ | **Done 2026-07-20** — `allowedServerIds` covers connect + tool-call | done |
| D-MCP-03 | Stock **RPC mode custom tools** | ADR 0008: Pi RPC has no dynamic register | P6 / ADR follow-up |
| D-MCP-04 | ~~Official MCP SDK client + handcrafted fallback~~ | **Done 2026-07-20** — dual client via `PIWIN_MCP_CLIENT` | done |
| D-MCP-05 | MCP SSE/HTTP transports (non-stdio) | stdio first-class only | later product |

### 2.3 Artifact

| ID | Item | Why deferred | Suggested |
|----|------|--------------|-----------|
| D-ART-01..04 | ~~Streaming / height / init / theme-repair~~ | Done in P2 polish | done |
| D-ART-05 | Lazy eviction / virtualize off-screen artifacts | measure after A2; owi LazyArtifactBlock | later |
| D-ART-06 | ~~Inline Artifact natural height~~ | **Superseded 2026-08-13** — Inline follows measured content up to the 16384px defensive ceiling; the old 900/2200px Expand path was removed | done |
| D-ART-07 | Runtime external-embed reporter script inside iframe | pre-render security enough for v1 | later |
| D-ART-08 | Hard theme-incompatible block mode | soft repair preferred | later |
| D-ART-09 | Side panel / fullscreen Artifact workspace (PRD AR-07) | opt-in preview shipped 2026-07-30; workspace is separate UX | later |
| D-ART-10 | Export single artifact HTML to project file (PRD AR-08) | needs project FS contract + permission policy | later |
| D-ART-11 | CLI HTML preview | CLI has no iframe host; NG6 in opt-in design | later |
| D-ART-12 | Light fence registry (native svg / html-preview / Cherry-style) | heavy sandboxed `svg` preview shipped 2026-07-31; parent-document light rendering still needs its own sanitizer and UX | later |

### 2.4 Git

| ID | Item | Why deferred | Suggested |
|----|------|--------------|-----------|
| D-GIT-01 | ~~stage / commit / branch~~ | Done | done |
| D-GIT-01b | ~~Composer branch chip (list local + checkout)~~ | **Done 2026-08-06** — `git/branch-list` + Desktop `BranchChip` on composer toolbar; confirm on dirty; disabled while streaming | done (minimal) |
| D-GIT-02 | Complex DAG visualization (multi-parent layout) | linear parent list sufficient | polish |
| D-GIT-03 | Auto-inject git status into agent prompt context | needs product policy | later |
| D-GIT-04 | force-push / hard reset / clean -fdx | explicitly out of v1 write slice | never silent; P6 if ever |
| D-GIT-05 | Session **workspace/space** switch chip (project root or registered worktree cwd) | Branch chip shipped first; multi-cwd is a separate product surface | after D-GIT-01b polish |
| D-CTX-01 | Composer **runtime target** chip pair: **本机 (Local / This Mac)** + **远程 Host (Remote Host)** | Host-first execution-location affordance; real remote target needs Host Server multi-client transport. **Ship UI first without fake connectivity.** | UI polish then M8 |
| D-CTX-01a | ~~Runtime chip **v0 (honest stub)**~~ | **Done 2026-08-06** — Desktop `RuntimeTargetChip`: **本机** active; **远程 Host** grey/disabled; tooltip **「未连接到远程服务器」** / “Not connected to a remote server”. No fake remote path. | done (stub) |
| D-CTX-01b | Runtime chip **v1 (connected)** | When a remote Host is connected, enable Remote Host; switching target must rebind session/runtime/tool/project fall-through — not a cosmetic toggle | after Host Server M8.6 |

### 2.5 Session / Host / Engineering

| ID | Item | Why deferred / unfinished | Suggested |
|----|------|---------------------------|-----------|
| D-M2-01 | ~~Product transcript cross-process resume~~ | **Done** product layer | done (product) |
| D-M2-01b | Full **Pi native JSONL** session resume + tree projection | **Superseded for branching by ADR 0055** (product-store tree). Residual is only “do not resume Pi JSONL” | later host (JSONL only) |
| D-M2-02 | ~~Session list + linear outline UI~~ | **Done light** — list preview/count/time + jump outline | done (light) |
| D-M2-02-full | Multi-leaf Pi branch graph UI | **Superseded by ADR 0055 ‹n/m› switcher**; a visual tree panel stays optional | later UI |
| S2-write-boundary | Conversation-tree Stage 5 write-boundary (warn-only confirm + git calibration) | **Done 2026-08-21** — `needs-confirmation` + Desktop/CLI confirm + `injectBranchCalibrationOnce`. Worktree button still waits on SF-06 | done (warn-only) |
| D-M2-03 | ~~Bash hard-gate~~ | Done | done |
| D-M2-04 | ~~Secret refs MVP (env + optional keychain)~~ | **Done** — no raw key save; `apiKeyRef` + doctor status | done (MVP) |
| D-M2-04b | Windows Credential Manager + migrate existing plaintext configs | macOS security CLI + env MVP only | polish |
| D-M2-05 | ~~Host e2e smoke~~ | **Done** — `pnpm e2e:smoke` + CI; Tauri driver still optional | done (host smoke) |
| D-M2-05b | Desktop UI e2e (Playwright) | **Local browser shell 2026-07-20** — `pnpm e2e:desktop` Vite+HostClient mock; Tauri WebDriver still residual | partial (browser) |
| D-M2-06 | Hot-switch agentMock + restart host | restart process manually | polish |
| D-M2-07 | ~~host-log UI panel~~ | **Done 2026-07-20** — ring buffer + HostLogPanel + bridge emit | done |
| D-HOST-01 | ~~RPC capability honesty (bounded)~~ | **Done** — clear CLI/RPC failure; `capabilities.customTools` | done (bounded) |
| D-HOST-01b | Full RPC **process isolation worker** | Absorbed into [`runtime-refactor.md`](./specs/runtime-refactor.md) Phase 3; SDK fallback remains transitional until its deletion gate | Runtime Refactor Phase 3 |
| D-HOST-02 | ~~Provider validation on load/save~~ | **Done** — validate + reject raw keys | done |
| D-HOST-03 | ~~Sub-agent / plan mode~~ | **Done 2026-07-20** H2 plan + H3 multi-session; residuals 03c/03d executed same day | done |
| D-HOST-03c | ~~Sub-agent Complete & merge~~ | **Done 2026-07-20** session/complete-subagent + merge-subagent → parent system message; extractive summary | done |
| D-HOST-03d | ~~Plan step progress L1+L2~~ | **Done 2026-07-20** plan/update-step + PlanPanel checklist + piwin_plan_set_step tool (SDK); L3 fence parse still deferred | done |
| D-HOST-03d-L3 | Plan fence parsing → plan progress | Untrusted free-text; deferred per residual plan §5.2 | deferred |
| D-HOST-03e | Follow-up turn lifecycle design: `session/follow_up` validates run ownership but a distinct foreground lifecycle (new `runId` + terminal event vs. append to existing run) is not introduced yet. | ADR/plan decision deferred from responsiveness evidence plan §5 item 3 — not a correctness blocker. | later ADR |
| D-HOST-04b | ~~Richer compaction end summary~~ | **Done 2026-07-20** full map of Pi CompactionResult (summary/tokens/durationMs) + banner details; spike note in docs/notes | done |
| D-HOST-04c | ~~Global auto-compact defaults~~ | **Done 2026-07-20** `compaction.autoEnabledDefault` + Settings toggle + session override source; project override deferred | done |

| D-HOST-04 | ~~Compaction UI~~ | **Done 2026-07-20** — session/compact IPC, banner, Compact button; auto-toggle residual D-HOST-04c | done |
| D-ENG-01 | ~~monorepo CI~~ | Done | done |
| D-ENG-02 | ~~Dependency policy + report-only audit~~ | **Done** — `docs/dependency-policy.md` + CI audit report-only | done (light) |
| D-ENG-03 | ~~Unsigned desktop package path~~ | **Done** — `pnpm package:desktop` + `docs/release-desktop.md` | done (unsigned) |
| D-ENG-03b | Code signing / notarization when certs available | `pnpm notarize:desktop` + workflow Notarize step; needs App Store Connect API secrets and Developer ID p12 on GitHub-hosted | later delivery |
| D-ENG-04 | cleanup corrupt `*.ts ***` filenames if any | eng hygiene | eng |

### 2.6 Theme / Pet residual

| ID | Item | Notes |
|----|------|-------|
| D-M6-03..06 | ~~Theme/Pet cores + hatch skills~~ | Done |
| D-PET-01 | Real Codex-size 1536×1872 art packs / gallery import UX polish | bundled small atlas + import path exist | content/polish |
| D-THEME-01 | ~~Remount artifacts on theme switch~~ | **Done 2026-07-20** — `artifactThemeKey` remount on ThemePanel apply | done |

### 2.7 Explicit non-goals / never silent

| ID | Item | Rule |
|----|------|------|
| X-01 | force-push / hard reset / `clean -fdx` without confirm | never silent |
| X-02 | Apps importing `@earendil-works/pi-*` | forbidden (AGENTS.md) |
| X-03 | ~~Base64 images in model context by default~~ | **Done 2026-08-01**: native `ImageContent` via adapter; path injection no longer default (ADR 0005 amendment) |
| X-04 | Executable theme/pet payloads (JS/CSS hooks) | blocked by validators |

### 2.8 Pi Extensions / Packages

| ID | Item | Why deferred / unfinished | Suggested |
|----|------|---------------------------|-----------|
| D-EXT-01 | ~~Extensions channel Slice 1 (scan/list/enable + ResourceLoader + path-guard)~~ | **Done 2026-07-21** — ADR 0010 | done |
| D-EXT-02 | ~~Desktop Extensions panel (list/toggle + security banner)~~ | **Done 2026-07-21** — ExtensionsPanel + rail + Settings | done |
| D-EXT-03 | ~~Install extensions local/git marketplace~~ | **Done 2026-07-21** — installExtension + IPC + UI/CLI | done |
| D-EXT-04 | ~~Extension UI confirm/select/input → Desktop~~ | **Done 2026-07-21** — bindExtensions + extension/ui_* + dialog | done |
| D-EXT-05 | ~~Prompt-templates channel~~ | **Done 2026-07-21** — ~/.piwin/prompts + ResourceLoader + PromptsPanel | done |
| D-EXT-06 | ~~Cross-source skill maps UX~~ | **Done 2026-07-21** — WELL_KNOWN presets in SkillsPanel | done |
| D-EXT-07 | ~~RPC SDK fallback for tools/extensions/prompts~~ | **Done 2026-07-21** — ADR 0011; stock isolation residual D-HOST-01b | done (fallback) |

### 2.9 Capability Expansion (LiveAgent parity via Pi) — Queued

> Spec program: [`docs/specs/program-capability-expansion.md`](./specs/program-capability-expansion.md).  
> Prefer Pi Extensions / ResourceLoader / customTools / FileOperations / contextUsage; no second agent kernel.  
> Do not collide with D-EXT-04 / D-HOST-01b.

| ID | Item | Wave | Spec | Status |
|----|------|------|------|--------|
| CE-MEM-01..04 | Memory store, tools, inject, Settings/CLI | W1 | [`w1-memory-process-chat.md`](./specs/w1-memory-process-chat.md) | **Partial 2026-07-21** — store/tools/Settings/CLI; extract residual |
| CE-MEM-05 | Silent memory extract (opt-in) | W1.5 | same | Future |
| CE-MEM-06 | Memory organizer | later | same | Future |
| CE-PROC-01..04 | ManagedProcess registry + tools + UI | W1 | same | **Done 2026-07-21** (WT-2) |
| CE-CHAT-01..05 | Pin, search, edit-resend, modes light | W1 | same | **Partial** — pin/search/edit; modes light residual |
| CE-OBS-01..02 | Token/context usage events + UI | W1 | same | **Partial** — usage chip + execution usage; densify residual. Cache countdown in usage popover is a client-side 5-min estimate from `updatedAt` (Pi exposes no TTL); replace with host-supplied TTL via `@piwin/contracts` if Pi adds one. |
| CE-SUB-01..05 | Worktree sub-agent, apply policy, concurrency | W2 | [`w2-subagent-compaction-pty.md`](./specs/w2-subagent-compaction-pty.md) | **Partial 2026-07-21** — worktree spawn/apply/UI; batch concurrency deferred |
| ORCH-01..05 | Orchestration Scheme（编排方案）Composer opt-in | after CE-SUB | [`orchestration-scheme.md`](./specs/orchestration-scheme.md) | **Queued 2026-08-07** — per-send Off/Ultra Code; no cross-session persist; contracts→host→desktop→cli |
| CE-COMP-01..03 | Pi FileOperations surface + Files touched inject | W2 | same | **Partial 2026-07-21** — normalize/inject/banner state; Pi extract best-effort |
| CE-PTY-01..03 | Real PTY terminal dock | W2 | same | **Partial 2026-07-21** — host pty/* + Desktop Activity/Terminal dock tabs (piped shell; node-pty later) |
| CE-MD-01..02 | KaTeX + Mermaid | W2 | same | **Done** (soft-fail fences) |
| CE-MODE-01 | chat / agent / agent-debug polish | W2 | same | Queued |
| CE-PROV-01 | Gemini-class provider presets | W2 | same | Queued |
| CE-HUB-SK-01..03 | Skills Hub + install jobs + sources | W3 | [`w3-marketplace-automation.md`](./specs/w3-marketplace-automation.md) | **Partial 2026-07-21** — Installed/Store tabs + store-list/install |
| CE-HUB-MCP-01..03 | MCP registry cards + install draft | W3 | same | **Partial 2026-07-21** — Configured/Registry tabs + install draft |
| CE-CRON-01..03 | Cron prompt/bash/http | W3 | same | **Partial 2026-07-21** — Settings Automation UI + prompt cron; bash/http later |
| CE-HOOK-01..02 | Lifecycle hooks runner | W3 | same | **Partial 2026-07-21** — Settings hooks UI + store; host arm on events residual |
| CE-TODO-01 | Session todo tool + Execution panel | W3 | same | **Partial 2026-07-21** — todo/get|set IPC + store; tool+panel deferred. **Note 2026-08-03:** PlanCard live progress uses SessionPlan + ADR 0025 (`onPlanUpdated`); do not merge Todo into PlanCard. |
| CE-SHARE-01 | Local session export MD/HTML | W4 | [`w4-remote-gateway.md`](./specs/w4-remote-gateway.md) | Queued |
| CE-GW-01..04 | Optional Gateway relay + WebUI + reconnect | W4 | [`host-server-multi-client.md`](./specs/host-server-multi-client.md) | After Host Server; ADR 0036 |
| CE-TUN-01 | Optional tunnel manager | W4 | same | After private Host transport |

**Start order:** CE-MEM + CE-PROC + CE-OBS → CE-CHAT → CE-SUB/CE-COMP → CE-PTY/CE-MD → W3 → Host Server M8 → optional W4 Gateway/tunnel/mobile.
**New packages:** `@piwin/memory`, `@piwin/process`, `@piwin/automation` (+ planned `@piwin/host-client`, `@piwin/host-transport`, `@piwin/host-server`, optional `apps/gateway`).


### 2.10 Product Depth (PD-*) — Active after polish priority

> Spec: [`docs/specs/product-depth-competitive-alignment.md`](./specs/product-depth-competitive-alignment.md)  
> Locks: archive-first · fork-light duplicate · post-event hooks only · Tauri PTY (ADR 0013)

| ID | Item | Status |
|----|------|--------|
| PD-SESS-01 | session/rename | **Done 2026-07-21** |
| PD-SESS-02 | session/archive + unarchive | **Done 2026-07-21** |
| PD-SESS-03 | session/delete permanent (from archive) | **Done 2026-07-21** |
| PD-SESS-04 | Session row context menu | **Done 2026-07-21** |
| PD-SESS-05 | `session/duplicate` (historically shipped as fork-light; now independent from SF-* response Fork) | **Done 2026-07-21** |
| PD-SESS-06..07 | Pinned section + show archived | **Done 2026-07-21** (pinned group + archive toggle) |
| PD-TRUE-01..04 | Capability honesty / Shell wording | **Done 2026-07-21** (pty=false, matrix, pills) |
| PD-STR-01..06 | App/host-runtime/host-client/ui-kit split | **Done** — domain command modules (catalog/mcp/git/plan/process/memory/pty/automation/resolve) + dispatchDomainCommands; session-live-commands extracted; HostRuntime is orchestrator+services |
| PD-UX-01..05 | Notifications, ErrorBoundary, empty states, a11y, remember manager | **Partial** — notify + ErrorBoundary + ChatEmptyState; a11y/remember residual |
| PD-DOC-01..04 | Backlog/status docs + bundled skills | **Partial** — product-status.md; bundled skills residual |
| PD-PTY-01..05 | Tauri PTY + xterm (ADR 0013) | Queued |
| PD-AUTO-01..02 | Post-event hooks only; no PreToolUse | Queued (thin) |
| PD-AUTO-04..05 | Todo tool+panel; cron run history | Queued |
| PD-SUB-01..03 | Sub-agent isolation labels | Queued |

**Start:** S0 docs → S1 rename/archive menu → S2 honesty → … → S7 Tauri PTY. Hooks are low product priority (user: rarely used).


### 2.11 Product Optimization (PO-*) — **Active execution program**

> Spec: [`docs/specs/product-optimization-program.md`](./specs/product-optimization-program.md)  
> Priority (L5): **A polish → B half-built honesty → C PTY spike-gated**  
> Locks: L1–L4 (from Product Depth) + L5–L8 (PO program)  
> Residual of PD-UX/DOC/PTY/AUTO/SUB is **tracked here** (PO-*), not re-opened under PD-*.

| ID | Item | Track | Status |
|----|------|-------|--------|
| PO-TRUST-01..03 | Permission remember list/revoke + trust copy | A P0 | **Done 2026-07-22** |
| PO-UX-01..04 | EmptyState/Spinner adoption + notification audit | A P0 | **Partial** — EmptyState/Spinner on main panels; notify residual |
| PO-SESS-01..02 | Session micro-UX + destructive confirm consistency | A P0 | **Partial** — archive-first + empty copy |
| PO-A11Y-01 | Focus / Escape e2e chains | A P0 | **Done 2026-07-22** — Settings Escape + session menu dismiss |
| PO-SKILL-01..06 | Bundled skills thin pack (6) | B P0 | **Done 2026-07-22** |
| PO-DOC-01..04 | Backlog/CE sync, product-status, README, architecture | B P0 | **Done 2026-07-22** |
| PO-AUTO-01..04 | Hooks/cron/todo honesty (time-boxed; hooks thin) | C P1 | **Partial** — banners + CLI cron list; last-run on jobs |
| PO-SUB-01..03 | Sub-agent mode chip + worktree + merge guidance | C P1 | **Done 2026-07-22** |
| PO-HUB-01..02 | Skills/MCP hub install path harden | C P1 | **Partial** — existing install + empty/spinner; progress residual |
| PO-OBS-01 | Usage chip + compaction banner density | C P1 | **Partial** — unknown usage wording already |
| PO-PTY-00 | Tauri PTY spike note (go/no-go) | D P2 | **Done 2026-07-22** |
| PO-PTY-01..04 | Full Tauri PTY + xterm **or** permanent Shell preview | D P2 | **Done 2026-07-22** — dual path: Tauri live PTY+xterm; mock Shell preview retained |
| PO-RES-01..05 | RPC isolation / gateway / JSONL tree / keychain / signing | E residual | Deferred (out of PO ship) |

**Slice order:** S0 docs → S1 trust → S2 UX → S3 skills → S4 a11y → S5 auto → S6 sub/obs → S7 hubs → S8 PTY spike → S9 PTY full or freeze.



### 2.12 Product-Shell Repair (PSR-*) — **Active execution program 2026-07-22**

> Plan: [`docs/plans/2026-07-22-desktop-product-shell-repair.md`](plans/2026-07-22-desktop-product-shell-repair.md)  
> Locks D1–D10 from product review. Removal-first; no new agent kernel, dashboard, or visual redesign.  
> **D1 (developer preview):** workspace `pnpm`/`tsx` host bridge only. Bundled Node runtime / installed-app sidecar packaging is **intentionally deferred** — not a completed release path.

| ID | Item | Status |
|----|------|--------|
| PSR-S0 | Baseline, contracts map, explicit preview truth, boundary viewport tests | **Done 2026-07-22** |
| PSR-S1 | Deterministic responsive shell + overlay ownership (`data-layout`, layer tokens) | **Done 2026-07-22** |
| PSR-S2 | Session-first work loop; Files / Activity / Review inspector; no auto-session on trust | **Done 2026-07-22** |
| PSR-S3 | Per-turn Model+Thinking profile; full-history continuity; Steer / Follow-up | **Done 2026-07-22** (host product history inject + setModel when SDK exposes) |
| PSR-S4 | Structured permissions; truthful status; native PTY trusted-project authorization | **Done 2026-07-22** (authorize-terminal + PermissionRequestCard; Tauri smoke residual) |
| PSR-S5 | Core vs Advanced Settings; transcript-visible subagent activity (no permanent panel) | **Done 2026-07-22** |
| PSR-S6 | Delete obsolete rail/dock paths; CSS ownership consolidation | **Done 2026-07-22** |
| PSR-S7 | Verification, docs, developer-preview release gate | **Done 2026-07-22** (browser e2e; Tauri smoke checklist in docs/notes) |
| PSR-D1 | Bundled host/Node runtime for installed Desktop | **Deferred by D1** — developer preview only. See also evidence-plan §5: packaged host distribution (bundled executable/Node, resource resolution, signing/notarization, clean-machine verification) requires a separate plan. |
| PSR-D2 | Desktop RPC mode / selectable `PiwinConfig.hostMode` on Desktop | **Deferred by D2** — Desktop SDK-only until worker isolation ships |
| PSR-D3 | First-run provider wizard / readiness gate blocking trust | **Deferred by D7** — out of scope |
| PSR-D4 | Pi JSONL multi-leaf session tree UI | **Deferred** — product shell remains linear |
| PSR-D5 | Provider-specific context compression beyond honest over-limit | **Deferred** |
| PSR-D6 | Terminal outside Tauri / CLI PTY parity | **Deferred by D3 scope** |

**Slice order:** S0 baseline → S1 layout → S2 session loop → S3 profile/intervention → S4 permissions+PTY → S5 advanced surfaces → S6 delete obsolete → S7 gate.


### 2.13 Quiet Workbench P0 convergence (QW-*) — post-P0 debt 2026-07-27

> Plan: [`docs/plans/2026-07-27-quiet-workbench-p0-convergence-plan.md`](plans/2026-07-27-quiet-workbench-p0-convergence-plan.md)
> Cleanup execution plan: [`docs/plans/2026-07-27-quiet-workbench-p0-debt-cleanup.md`](plans/2026-07-27-quiet-workbench-p0-debt-cleanup.md)
> Primitive base styles now live in `@piwin/ui-kit/styles.css`; desktop keeps region refinements + z-layers only.

| ID | Item | Status |
|----|------|--------|
| QW-BTN-01 | Migrate 21 raw `.btn*` usages in `NotesPanel.tsx` / `FlashcardsPanel.tsx` to ui-kit `Button` | **Done 2026-07-27** |
| QW-BTN-02 | Remove legacy `.btn*` rules from `ui-foundations.css` once QW-BTN-01 lands | **Done 2026-07-27** |
| QW-BTN-03 | Verify + delete `.icon-btn` rule in `ui-foundations.css` (no bare TSX consumer found; suspected dead) | **Done 2026-07-27** |

---

### 2.14 Product-level Session Fork (SF-*) — active implementation 2026-08-09

> Spec: [`docs/specs/session-fork-product-adaptation.md`](specs/session-fork-product-adaptation.md)
> Product lock: Duplicate is an independent complete copy; Fork is a linked
> transcript prefix through a selected completed assistant response. Product
> lineage is not Pi `SessionTreeView`, transcript outline, Git history, or
> subagent parentage.

| ID | Item | Status |
|----|------|--------|
| SF-00 | Contracts + decision alignment (`ProductSessionOrigin`, lineage, Fork IPC) | **Done 2026-08-09** — product origin, lineage, and Fork IPC contracts are in place |
| SF-01 | Derived-session core + harden Duplicate media ownership | **Queued** — existing Duplicate shares source attachment paths and must be fixed before response entry ships |
| SF-02 | Shared-workspace `session/fork` + `session/lineage` Host path | **Active** — shared Host path and deterministic Desktop mock are wired; CLI parity remains queued |
| SF-03 | Assistant response footer: inline SVG Duplicate + Fork icons | **Active** — response actions are mounted and functional; visibility matrix remains under test |
| SF-04 | Source badge, direct-fork count, lightweight sidebar lineage navigation | **Active** — response-level session-tree popover and branch resume shipped 2026-08-09; sidebar grouping/deep breadcrumb remain queued |
| SF-05 | CLI parity for duplicate/fork/lineage | **Queued** — same Host semantics, no separate CLI implementation |
| SF-06 | Optional isolated session-fork worktree | **Future** — separate from subagent fields; no historical checkpoint claim |
| SF-07 | Pi native JSONL tree/active-leaf spike | **Future / spike-first** — may optimize Host later; does not block SF-00..06 |

**Execution order:** SF-00 → SF-01 → SF-02 → SF-03 → SF-04 → SF-05;
SF-06 follows core adoption, and SF-07 remains independently spike-gated.

### 2.15 Context Menu Surfaces (CM-*) — P0 + P1 shipped 2026-08-10

> Spec: [`docs/specs/context-menu-surfaces.md`](specs/context-menu-surfaces.md)  
> P0 slice (right-click → Agent entry): `selection`/`folder` contracts + Host resolve,
> composer context-ref chips + `PromptInput.contextRefs`, catalog/dispatch, file-tree +
> path-chip + code-preview selection menus, drag-to-ref. P1 slice: message / code-block /
> diff-row / tool-card / terminal-selection / error menus, Apply P1a (copy+preview+notice),
> More… submenu, `@` mention → structured refs. All shipped 2026-08-10 via one
> app-level `DesktopContextMenuProvider` so deep components share one dispatcher set.

| ID | Item | Status |
|----|------|--------|
| CM-01 | contracts `selection` + `folder`; Host resolve + tests | **Done 2026-08-10** |
| CM-02 | composer pending refs + chips + send `contextRefs` | **Done 2026-08-10** (host test proves refs on prompt) |
| CM-03 | `catalog.ts` + P0 surface tests | **Done 2026-08-10** |
| CM-04 | `ContextMenuFromCatalog` + `dispatch.ts` | **Done 2026-08-10** |
| CM-05 | File tree file/folder context menu | **Done 2026-08-10** (unit) |
| CM-06 | PathChip menu upgrade | **Done 2026-08-10** (unit) |
| CM-07 | Code preview selection + Explain/Fix presets | **Done 2026-08-10** (typecheck + unit; manual smoke TBD) |
| CM-08 | Drag path → context ref | **Done 2026-08-10** (chip; text fallback kept) |
| CM-09 | en/zh labels | **Done 2026-08-10** (catalog-local tables; desktop-locale merge optional) |
| CM-10 | Message context menu (share catalog with hover) | **Done 2026-08-10** (chat bubble menu, capability-gated) |
| CM-11 | Code block menu + Apply P1a | **Done 2026-08-10** (fence menu; Apply = copy + preview + notice) |
| CM-12 | Diff row menu | **Done 2026-08-10** (DiffCard menu) |
| CM-13 | Tool card / terminal / error menus + fix-error | **Done 2026-08-10** (ToolCallCard / XtermSurface / MainErrorBanner) |
| CM-14 | Apply P1b write confirm | **Deferred 2026-08-12** — branch draft excluded from main integration (no registered-root/symlink guard, no Host permission gate). Apply ships as **P1a** (copy + preview + notice) until redesigned on hardened project commands |
| CM-15 | open-changed-files / rerun-tool | **Done 2026-08-10** (open-changed-files → Review tab; rerun announces unavailability) |
| CM-16 | More… submenu (review/tests) | **Done 2026-08-10** (ui-kit ContextMenuSub) |
| CM-17 | `@` mention also writes pending refs | **Done 2026-08-10** (file/folder at-items → refs) |
| CM-18 | CLI note / optional ref flags parity | **Done 2026-08-10** (`piwin chat --ref <path>` → contextRefs; file/folder auto-detect; unit-tested) |

---

## 3. Done archive (recent)

| Date | Item | Where |
|------|------|-------|
| 2026-07-27 | QW-BTN-01/02/03 retire legacy `.btn` / `.icon-btn` (NotesPanel + FlashcardsPanel → ui-kit `Button`) | desktop + `ui-foundations.css` |
| 2026-07-20 | M2 Agent Window MVP | `docs/specs/m2-execution-plan.md` |
| 2026-07-20 | M3 media + tools-web kernel/CLI | `docs/specs/m3-media-web.md` |
| 2026-07-20 | M4 skills/mcp/marketplace + CLI | `docs/specs/m4-skills-mcp.md` |
| 2026-07-20 | Media IPC + desktop paste/drop/chips | agent-host + desktop |
| 2026-07-20 | Web tool permission gate | agent-host session-tools |
| 2026-07-20 | ADR 0008 + customTools + MCP bridge + skill loader | `docs/adr/0008-skills-mcp-pi-wiring.md` |
| 2026-07-20 | Skills/MCP desktop panels + host IPC | desktop |
| 2026-07-20 | Artifact pure runtime + polish (height/stream/theme) | `@piwin/artifact` |
| 2026-07-20 | Git read/write + Theme tokens/UI | `@piwin/git` + `@piwin/theme` |
| 2026-07-20 | P1 wrap-up: web settings/citations, skill install, MCP form, media asset scope | desktop + host |
| 2026-07-20 | P5 Pet + P6 core (gated bash, doctor, CI) | pet + agent-host + cli |
| 2026-07-20 | P6 security: SSRF, project network remember, file-picker | tools-web + project + desktop |
| 2026-07-20 | Session product transcript + resume hydrate | session + agent-host + desktop |
| 2026-07-20 | MCP lifecycle manager (status/start/stop) + Desktop controls | `@piwin/mcp` + host + McpPanel |
| 2026-07-20 | P6 main-path M1–M5 (MCP share/SDK, session outline, secrets, doctor/smoke, package docs) | plan + ADR 0008/0009 |
| 2026-07-20 | D-HOST-03c/03d/04b/04c residuals | complete+merge, plan steps+tool, compact summary, auto-compact default |
| 2026-07-20 | D-HOST-04 Compaction UI (H1) | contracts + host + desktop banner/button |
| 2026-07-20 | D-HOST-03 H2 Plan artifact | plan.ts, plan-store, plan/* IPC, PlanPanel, prompt inject |
| 2026-07-20 | D-HOST-03 H3 Sub-agent multi-session | spawn/list-children/cancel + SubAgentPanel |
| 2026-07-21 | D-EXT-01 Pi Extensions channel Slice 1 | ADR 0010, host scanner, path-guard, CLI |
| 2026-07-21 | Capability Expansion program specs (W1–W4) | `docs/specs/program-capability-expansion.md` + `w1`–`w4` |
| 2026-07-21 | CE batch-2 partial (SUB/COMP/PTY/Hubs/Automation host) | git worktree, compaction-file-ops, pty-host, @piwin/automation, marketplace registry |
| 2026-07-21 | Desktop PTY + Settings Hub/Automation UI | terminal-dock Terminal tab, Skills Store, MCP Registry, AutomationPanel |
| 2026-07-21 | D-EXT-02 Desktop Extensions panel | ExtensionsPanel, rail, Settings, mock host, e2e |
| 2026-07-21 | D-EXT-03/05/06/07 extensions install, prompts, skill maps, RPC SDK fallback | ADR 0011 + marketplace + panels |
| 2026-07-21 | D-EXT-04 Extension UI bridge (confirm/select/input) | extension-ui-bridge + Desktop dialog; ADR 0012 worker residual |




---

## 4. How to add a deferred item

When skipping work intentionally:

1. Add a row under the right §2 subsection with stable ID.
2. Write **Why deferred** in one line (not “later”).
3. Prefer **Suggested** phase (`polish` / `P6` / `later` / `never silent`).
4. Do **not** delete unfinished rows when shipping a partial slice — mark partial done and add residual IDs (example: D-M2-01 + D-M2-01b).

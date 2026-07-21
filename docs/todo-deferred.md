# piwin Canonical Backlog

| Field | Value |
|-------|-------|
| Status | Living execution backlog |
| Updated | 2026-07-21 |
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
   - **R5 extensions follow-on:** mostly done (D-EXT-01..03,05..07); residual D-EXT-04 UI bridge + D-HOST-01b isolation  
5. **Parallel (other sessions):** **D-EXT-04** extension confirm→Desktop · **D-HOST-01b** RPC worker isolation — do not thrash those files.
6. **Capability Expansion program (queued):** LiveAgent-class features via Pi ecosystem —  
   [`docs/specs/program-capability-expansion.md`](./specs/program-capability-expansion.md) · W1–W4 `docs/specs/w*.md` · backlog **CE-*** in §2.9.

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

---

## 2. Intentionally deferred / unfinished (must not vanish)

### 2.1 Media / Desktop polish

| ID | Item | Why deferred / unfinished | Suggested |
|----|------|---------------------------|-----------|
| D-MED-01 | ~~Tauri media asset scope~~ | Done | done |
| D-MED-02 | ~~Historical attachment hydration~~ | Done via product transcript | done |
| D-MED-03 | ~~File-picker attach~~ | Done | done |
| D-MED-04 | Thumbnail cache / dimensions | optional quality | polish |
| D-WEB-01 | ~~Web settings + citations~~ | Done | done |
| D-WEB-02 | ~~Project-remember network~~ | Done | done |
| D-WEB-03 | ~~SSRF depth~~ | Done | done |

### 2.2 Skills / MCP

| ID | Item | Why deferred / unfinished | Suggested |
|----|------|---------------------------|-----------|
| D-SK-01 | ~~Desktop Skill install~~ | Done | done |
| D-SK-02 | Richer bundled skill templates | find/create/web-research/hatch-* present; content expansion later | content |
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
| D-ART-06 | ~~Expand height >900 with toggle~~ | **Done 2026-07-20** — `MAX_ARTIFACT_EXPANDED_HEIGHT=2200` + Expand/Collapse | done |
| D-ART-07 | Runtime external-embed reporter script inside iframe | pre-render security enough for v1 | later |
| D-ART-08 | Hard theme-incompatible block mode | soft repair preferred | later |

### 2.4 Git

| ID | Item | Why deferred | Suggested |
|----|------|--------------|-----------|
| D-GIT-01 | ~~stage / commit / branch~~ | Done | done |
| D-GIT-02 | Complex DAG visualization (multi-parent layout) | linear parent list sufficient | polish |
| D-GIT-03 | Auto-inject git status into agent prompt context | needs product policy | later |
| D-GIT-04 | force-push / hard reset / clean -fdx | explicitly out of v1 write slice | never silent; P6 if ever |

### 2.5 Session / Host / Engineering

| ID | Item | Why deferred / unfinished | Suggested |
|----|------|---------------------------|-----------|
| D-M2-01 | ~~Product transcript cross-process resume~~ | **Done** product layer | done (product) |
| D-M2-01b | Full **Pi native JSONL** session resume + tree projection | **Spike decision ADR 0009: product shell only**; Pi JSONL still residual | later host |
| D-M2-02 | ~~Session list + linear outline UI~~ | **Done light** — list preview/count/time + jump outline | done (light) |
| D-M2-02-full | Multi-leaf Pi branch graph UI | intentionally not main path | later UI |
| D-M2-03 | ~~Bash hard-gate~~ | Done | done |
| D-M2-04 | ~~Secret refs MVP (env + optional keychain)~~ | **Done** — no raw key save; `apiKeyRef` + doctor status | done (MVP) |
| D-M2-04b | Windows Credential Manager + migrate existing plaintext configs | macOS security CLI + env MVP only | polish |
| D-M2-05 | ~~Host e2e smoke~~ | **Done** — `pnpm e2e:smoke` + CI; Tauri driver still optional | done (host smoke) |
| D-M2-05b | Desktop UI e2e (Playwright) | **Local browser shell 2026-07-20** — `pnpm e2e:desktop` Vite+HostClient mock; Tauri WebDriver still residual | partial (browser) |
| D-M2-06 | Hot-switch agentMock + restart host | restart process manually | polish |
| D-M2-07 | ~~host-log UI panel~~ | **Done 2026-07-20** — ring buffer + HostLogPanel + bridge emit | done |
| D-HOST-01 | ~~RPC capability honesty (bounded)~~ | **Done** — clear CLI/RPC failure; `capabilities.customTools` | done (bounded) |
| D-HOST-01b | Full RPC **process isolation worker** | ADR 0012 design; product uses SDK fallback (0011) | residual worker |
| D-HOST-02 | ~~Provider validation on load/save~~ | **Done** — validate + reject raw keys | done |
| D-HOST-03 | ~~Sub-agent / plan mode~~ | **Done 2026-07-20** H2 plan + H3 multi-session; residuals 03c/03d executed same day | done |
| D-HOST-03c | ~~Sub-agent Complete & merge~~ | **Done 2026-07-20** session/complete-subagent + merge-subagent → parent system message; extractive summary | done |
| D-HOST-03d | ~~Plan step progress L1+L2~~ | **Done 2026-07-20** plan/update-step + PlanPanel checklist + piwin_plan_set_step tool (SDK); L3 fence parse still deferred | done |
| D-HOST-03d-L3 | Plan fence parsing → plan progress | Untrusted free-text; deferred per residual plan §5.2 | deferred |
| D-HOST-04b | ~~Richer compaction end summary~~ | **Done 2026-07-20** full map of Pi CompactionResult (summary/tokens/durationMs) + banner details; spike note in docs/notes | done |
| D-HOST-04c | ~~Global auto-compact defaults~~ | **Done 2026-07-20** `compaction.autoEnabledDefault` + Settings toggle + session override source; project override deferred | done |

| D-HOST-04 | ~~Compaction UI~~ | **Done 2026-07-20** — session/compact IPC, banner, Compact button; auto-toggle residual D-HOST-04c | done |
| D-ENG-01 | ~~monorepo CI~~ | Done | done |
| D-ENG-02 | ~~Dependency policy + report-only audit~~ | **Done** — `docs/dependency-policy.md` + CI audit report-only | done (light) |
| D-ENG-03 | ~~Unsigned desktop package path~~ | **Done** — `pnpm package:desktop` + `docs/release-desktop.md` | done (unsigned) |
| D-ENG-03b | Code signing / notarization when certs available | private v1 unsigned OK | later delivery |
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
| X-03 | Base64 images in model context by default | path injection only |
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
| CE-MEM-01..04 | Memory store, tools, inject, Settings/CLI | W1 | [`w1-memory-process-chat.md`](./specs/w1-memory-process-chat.md) | Queued |
| CE-MEM-05 | Silent memory extract (opt-in) | W1.5 | same | Future |
| CE-MEM-06 | Memory organizer | later | same | Future |
| CE-PROC-01..04 | ManagedProcess registry + tools + UI | W1 | same | **Done 2026-07-21** (WT-2) |
| CE-CHAT-01..05 | Pin, search, edit-resend, modes light | W1 | same | Queued |
| CE-OBS-01..02 | Token/context usage events + UI | W1 | same | Queued |
| CE-SUB-01..05 | Worktree sub-agent, apply policy, concurrency | W2 | [`w2-subagent-compaction-pty.md`](./specs/w2-subagent-compaction-pty.md) | Queued |
| CE-COMP-01..03 | Pi FileOperations surface + Files touched inject | W2 | same | Queued |
| CE-PTY-01..03 | Real PTY terminal dock | W2 | same | Queued |
| CE-MD-01..02 | KaTeX + Mermaid | W2 | same | Queued |
| CE-MODE-01 | chat / agent / agent-debug polish | W2 | same | Queued |
| CE-PROV-01 | Gemini-class provider presets | W2 | same | Queued |
| CE-HUB-SK-01..03 | Skills Hub + install jobs + sources | W3 | [`w3-marketplace-automation.md`](./specs/w3-marketplace-automation.md) | Queued |
| CE-HUB-MCP-01..03 | MCP registry cards + install draft | W3 | same | Queued |
| CE-CRON-01..03 | Cron prompt/bash/http | W3 | same | Queued |
| CE-HOOK-01..02 | Lifecycle hooks runner | W3 | same | Queued |
| CE-TODO-01 | Session todo tool + Execution panel | W3 | same | Queued |
| CE-SHARE-01 | Local session export MD/HTML | W4 | [`w4-remote-gateway.md`](./specs/w4-remote-gateway.md) | Queued |
| CE-GW-01..04 | Personal gateway + WebUI + reconnect | W4 | same | Future (ADR first) |
| CE-TUN-01 | Tunnel manager | W4 | same | Future |

**Start order:** CE-MEM + CE-PROC + CE-OBS → CE-CHAT → CE-SUB/CE-COMP → CE-PTY/CE-MD → W3 → W4.  
**New packages:** `@piwin/memory`, `@piwin/process`, `@piwin/automation` (+ optional `apps/gateway`).


---

## 3. Done archive (recent)

| Date | Item | Where |
|------|------|-------|
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

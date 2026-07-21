# Program Spec — Capability Expansion (LiveAgent parity via Pi ecosystem)

| Field | Value |
|-------|-------|
| Status | **Draft for implementation** |
| Date | 2026-07-21 |
| Source | LiveAgent product audit + piwin PRD/architecture |
| Canonical backlog | [`docs/todo-deferred.md`](../todo-deferred.md) §2.9 |
| Binding | `AGENTS.md`, ADR 0008/0009/0010/0011 |
| Parallel tracks (do not collide) | **D-EXT-04** extension confirm→Desktop · **D-HOST-01b** RPC worker isolation |

---

## 0. One-liner

Ship a **full local-agent product surface** (memory, managed processes, chat recoverability, worktree sub-agents, hubs, automation, optional remote) by **extending piwin’s shell on Pi**, not by forking LiveAgent or reimplementing Pi.

---

## 1. Goals

1. Close the gap vs LiveAgent **capabilities** users feel (remember, run long jobs, edit/retry, parallel agents, install tools, schedule, remote later).
2. **Maximize Pi ecosystem**: Extensions, Skills, Prompt templates, Packages, Compaction `FileOperations`, `contextUsage`, ResourceLoader, customTools — prefer these over parallel runtimes.
3. Keep architecture: apps ↛ Pi; only `@piwin/agent-host` imports Pi; contracts-first; SDK + RPC dual mode remains honest.
4. Preserve piwin differentiators: CLI↔Desktop same host, Theme/Pet/Artifact, dual host, `~/.piwin` single root.

## 2. Non-goals (program-wide)

| Non-goal | Why |
|----------|-----|
| Second agent kernel (Codex SDK / Claude Agent SDK side-by-side) | Violates host boundary; Pi is kernel |
| Copy LiveAgent monorepo / Rust tool executors | We stay TS packages + Pi tools |
| Cloud multi-tenant / public history share by default | private first |
| Full IDE (LSP, multi-file editor) | agent shell |
| Replacing D-EXT-04 / D-HOST-01b designs | those tracks own UI confirm + RPC isolation |

## 3. Parallel-track contracts (must not thrash)

### 3.1 D-EXT-04 (in flight) — Extension UI → Desktop

**Assume shipping soon:** `ctx.ui.confirm` / `select` / `input` route through host → Desktop modal (`extension/ui_resolve`).

**This program must:**

- Use extension `tool_call` gates that call `ctx.ui.confirm` **without** inventing a second confirm IPC.
- Not rewrite `extension-ui-bridge.ts` except additive fixes if a wave uncovers a gap (file a residual; don’t redesign).

### 3.2 D-HOST-01b (in flight) — RPC worker isolation

**Assume:** stock Pi RPC still weak for custom tools; product path may isolate worker; ADR 0011 SDK fallback already exists.

| Capability class | Default mode | After D-HOST-01b |
|------------------|--------------|------------------|
| customTools (web, MCP, memory tools, process tools) | **SDK** | same contracts on isolated worker if tools available |
| Pi Extensions load | SDK + ResourceLoader | worker must load same `additionalExtensionPaths` |
| Plain chat / resume | SDK or RPC | either |
| Doctor honesty | `capabilities.*` flags | never silent degrade |

**Rule:** Implement features against **contracts + HostRuntime**, not against a specific adapter class. Adapter gaps = capability flag false + clear error.

---

## 4. Pi ecosystem leverage matrix (decision table)

For every feature, pick the **highest row that fits** before inventing host-only machinery.

| Need | Prefer Pi | piwin owns | Forbidden |
|------|-----------|------------|-----------|
| Inject context each prompt | Extension `before_agent_start` / `context` | memory index text builder | Desktop rewriting system prompt |
| LLM-callable tools | Extension `registerTool` **or** host `customTools` (permission-gated) | pure logic in packages | UI invoking tools |
| Block/mutate tool calls | Extension `tool_call` | policy data under `~/.piwin` | second permission kernel |
| Compaction customize | `session_before_compact` + Pi summary | surface `fileOps` in UI | reimplement LiveAgent segment DB as kernel |
| File touch ledger | Pi `FileOperations` / `computeFileLists` | product transcript annotation | parallel ledger ignoring Pi |
| Token usage | Pi `contextUsage` / assistant usage | `AgentEvent` map + UI | fake percentages |
| Skills/prompts/themes | ResourceLoader + Pi packages | install paths under `~/.piwin` | fork skill loaders |
| Lifecycle hooks | Extension events **or** host `AgentEvent` runner | user hook config + shell runner | app-side monkey patch of Pi |
| Share extensions | Pi package (`pi` key in package.json) | marketplace install into `~/.piwin` | npm-only without ResourceLoader |
| Long-running process | custom tool + host process manager | `@piwin/process` | spawn from renderer |
| Cron | **outside** Pi loop (host scheduler) | `@piwin/automation` | blocking agent session for cron |
| Remote control | N/A in Pi | optional gateway later | putting secrets in gateway |

### 4.1 Extension vs host customTools

| Use **bundled extension** when | Use **host customTools** when |
|--------------------------------|-------------------------------|
| Community-portable, pure Pi, no host IPC | Needs PermissionPolicy, MCP lifecycle, media, project trust |
| Event hooks (`before_agent_start`, `tool_call`) | Must work with doctor/capabilities flags |
| Optional / user-disable via Extensions panel | Core product path always on |

**Default product policy:**

- **Core always-on tools** (`memory_*`, `process_*`, `todo_*`): host `customTools` + permission.
- **Portable policies** (extra path-guard patterns): bundled extensions under `~/.piwin/extensions`.
- **User hooks (shell/http):** HostRuntime on normalized `AgentEvent` (primary); thin bridge extension only if event not mapped.

---

## 5. Package / ownership map (new + existing)

```text
apps/desktop, apps/cli
    ↓
@piwin/session          ← pin, search index, truncate/resend, usage cards
@piwin/memory           ← NEW: store, FTS, index overview, quota
@piwin/process          ← NEW: managed process registry
@piwin/automation       ← NEW: cron + hooks config/runner
@piwin/marketplace      ← expand: MCP registry + skill hub sources
@piwin/git              ← worktree create/apply for sub-agents
@piwin/mcp, skills, media, artifact, theme, pet, tools-web, project
    ↓
@piwin/agent-host       ← tools, extension paths, events, scheduler arm
    ↓
@piwin/contracts
```

| Package | New? | Responsibility |
|---------|------|----------------|
| `@piwin/memory` | yes | Markdown + SQLite FTS, CRUD, overview injection text, quota |
| `@piwin/process` | yes | ManagedProcess start/list/logs/stop, cwd/timeout policy |
| `@piwin/automation` | yes | Cron jobs, hook definitions, run log; no Pi imports |
| `@piwin/session` | extend | pin, FTS/search projection, message truncate, execution mode |
| `@piwin/git` | extend | worktree create/remove, apply helpers |
| `@piwin/marketplace` | extend | registry adapters |
| `@piwin/agent-host` | extend | wire tools/events/scheduler; **only** Pi import site |
| `@piwin/contracts` | extend | types + HostCommand surface |
| apps/desktop | extend | panels; never FS for product data |
| apps/cli | extend | parity commands |

Bundled Pi extensions (seeded to `~/.piwin/extensions`):

| Extension id | Role |
|--------------|------|
| `path-guard` | already exists |
| `memory-bridge` | optional: reads overview cache if host injection skipped |
| `hooks-bridge` | only if host cannot map needed events |
| `file-ops-surface` | optional compact details |

---

## 6. Waves (all in scope)

| Wave | Theme | Spec | Priority |
|------|-------|------|----------|
| **W1** | Memory + ManagedProcess + Chat recoverability + Usage | [`w1-memory-process-chat.md`](./w1-memory-process-chat.md) | P0 |
| **W2** | Sub-agent worktree + Compaction fileOps + PTY + Rich MD + modes | [`w2-subagent-compaction-pty.md`](./w2-subagent-compaction-pty.md) | P0/P1 |
| **W3** | Skills Hub + MCP Registry + Cron + Hooks + Todo | [`w3-marketplace-automation.md`](./w3-marketplace-automation.md) | P1 |
| **W4** | Personal remote Gateway + Tunnel + export/share | [`w4-remote-gateway.md`](./w4-remote-gateway.md) | P2 |

**Execution rule:** W1 → W2 core → W3 → W4. Rendering (KaTeX/Mermaid) and provider presets can parallelize with W1/W2.

---

## 7. Cross-cutting requirements

### 7.1 Config root

```text
~/.piwin/
  config.json
  memory/                     # @piwin/memory
  process/                    # optional
  automation/
    cron.json
    hooks.json
    runs/
  sessions-index/             # pin, search projection
  extensions/                 # ADR 0010
  skills/, mcp.json, media/, themes/, pets/, prompts/, logs/
```

### 7.2 Security baseline

- Memory / process / cron / hooks through PermissionPolicy or Settings enable.
- No secrets in memory markdown (redact patterns).
- ManagedProcess: argv array only; cwd trusted project.
- Cron bash: hard-gate; prompt-type default for first ship.
- Tunnel / Gateway: token auth; keys stay on desktop.
- Extensions full privilege when enabled — existing UI banner.

### 7.3 Events

| Event | Source |
|-------|--------|
| `usage/update` | Pi contextUsage / last assistant usage |
| `process/*` | managed process lifecycle |
| `memory/extraction_*` | optional silent extract |
| `automation/cron_*` | scheduler |
| `subagent/worktree_*` | worktree lifecycle |

### 7.4 Testing bar

| Layer | Required |
|-------|----------|
| Pure package logic | unit tests colocated |
| Host tool + permission | fixture tests |
| IPC contracts | typecheck + host command tests |
| Desktop | e2e for critical paths |
| Extensions | ResourceLoader fixture when possible |

### 7.5 CLI parity

```text
piwin memory list|search|write|delete
piwin process list|logs|stop
piwin session pin|search|truncate
piwin cron list|run|disable
piwin hook list
piwin marketplace search mcp|skill
piwin session export
```

---

## 8. Success criteria (program)

1. User can: remember a fact across sessions; start ManagedProcess; edit/resend; see token usage; spawn worktree sub-agent and merge; install MCP from registry; schedule prompt cron.
2. `pnpm typecheck` + package tests green; doctor reports new capabilities.
3. No app imports of `@earendil-works/pi-*`.
4. D-EXT-04 / D-HOST-01b land without thrashing (additive only on shared files).
5. Specs linked from `todo-deferred.md` §2.9.

---

## 9. Risk register

| Risk | Mitigation |
|------|------------|
| Scope explosion | Waves shippable; W4 gated by ADR |
| Memory extract cost | MVP manual + tool; silent extract opt-in |
| Process zombies | host dispose + killOnHostDispose |
| Worktree disk bloat | cleanup on complete; retain flag |
| Registry supply chain | pin versions; command preview; no auto-run scripts |
| Gateway attack surface | W4 feature flag + ADR |
| Fighting D-EXT-04 | consume confirm, don’t fork |

---

## 10. Document index

| Doc | Content |
|-----|---------|
| This file | Program rules, Pi matrix, waves |
| [`w1-memory-process-chat.md`](./w1-memory-process-chat.md) | Memory, process, pin/search/resend, usage |
| [`w2-subagent-compaction-pty.md`](./w2-subagent-compaction-pty.md) | Worktree sub-agent, fileOps, PTY, modes, KaTeX/Mermaid |
| [`w3-marketplace-automation.md`](./w3-marketplace-automation.md) | Hubs, cron, hooks, todo |
| [`w4-remote-gateway.md`](./w4-remote-gateway.md) | Gateway, tunnel, export/share |

Executable plans under `docs/plans/` when a wave starts.

---

## 11. ID catalog

| ID | Wave | Title |
|----|------|-------|
| CE-MEM-01..06 | W1 | Memory store/tools/UI/inject/extract/quota |
| CE-PROC-01..04 | W1 | ManagedProcess tool/UI/policy/dispose |
| CE-CHAT-01..05 | W1 | Pin, search, edit-resend, modes light |
| CE-OBS-01..02 | W1 | Usage event + UI |
| CE-SUB-01..05 | W2 | Worktree, apply_policy, concurrency, roster, bus-lite |
| CE-COMP-01..03 | W2 | fileOps surface, checkpoint UI, Files touched |
| CE-PTY-01..03 | W2 | Real PTY dock |
| CE-MD-01..02 | W2 | KaTeX, Mermaid |
| CE-MODE-01 | W2 | chat / agent / agent-debug |
| CE-PROV-01 | W2 | Gemini / extra presets |
| CE-HUB-SK-01..03 | W3 | Skills Hub |
| CE-HUB-MCP-01..03 | W3 | MCP registry |
| CE-CRON-01..03 | W3 | Cron |
| CE-HOOK-01..02 | W3 | Hooks |
| CE-TODO-01 | W3 | Session todo |
| CE-GW-01..04 | W4 | Gateway |
| CE-TUN-01 | W4 | Tunnel |
| CE-SHARE-01 | W4 | Export/share |

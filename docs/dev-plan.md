# piwin Development Plan

| Field | Value |
|-------|-------|
| Status | Active — M2 done; see todo-deferred |
| Date | 2026-08-04 |
| Based on | `docs/prd.md` v0.2, locked product decisions |
| Repo | `~/Projects/piwin` |

---

## 1. Guiding principles

1. **Architecture before features**: dual-mode host + contracts stay real.
2. **Vertical slices**: each milestone ships a usable path, not only folders.
3. **Research-hard parts first enough**: artifact/media security from `openwebui_m`.
4. **Private, local-first**: no cloud multi-tenant work.
5. **Anti-shitpile**: follow `AGENTS.md`; contracts-first; no UI→Pi imports.

---

## 1.1 Active cross-cutting architecture program

Settings、Project Trust、Pi resources、Host custom tools、图片 prompt 路由与
live Agent Runtime 的统一改造，以以下 Spec 为执行权威：

- [`docs/specs/settings-capability-runtime-refactor.md`](./specs/settings-capability-runtime-refactor.md)

Runtime 控制面与执行面的三阶段改造，以一份连续 Spec 为执行权威：

- [`docs/specs/runtime-refactor.md`](./specs/runtime-refactor.md)

实施顺序固定为：先完成 Settings 控制面、精确 manifests、Prompt
Preparation 与 runtime generation 前置条件；再按 Runtime Spec 的 Phase 1
Unified Job Control → Phase 2 Structured Concurrency → Phase 3 Agent Worker
Isolation 推进。每一阶段必须完成本阶段旧路径删除门槛后才能进入下一阶段。
原 Phase 7 worker plan 只保留为历史分析，不再是执行权威。

---

## 2. Current baseline (done)

- [x] Repo scaffold monorepo (`apps/*`, `packages/*`)
- [x] PRD / architecture / artifact research / ADRs 0001–0005
- [x] `@piwin/contracts` host/config/media/artifact types
- [x] `@piwin/agent-host` dual-mode stubs (`PiSdkAdapter`, `PiRpcAdapter`)
- [x] CLI stub (`doctor`, `host-mode`)
- [x] Desktop placeholder
- [x] `AGENTS.md` engineering rules + code standards

---

## 3. Milestone plan

### M0 — Engineering foundation (this week)

**Goal**: repo is installable, typechecks, standards enforced, plan clear.

| # | Task | Owner package | Exit criteria |
|---|------|---------------|---------------|
| M0.1 | Expand `AGENTS.md` code standards | root | agents + humans have ban list + dep graph |
| M0.2 | Tooling: TS, vitest, eslint/prettier (or biome), scripts | root | `pnpm install && pnpm typecheck && pnpm test` work |
| M0.3 | Fix package graphs / workspace deps | all packages | CLI can import host/contracts |
| M0.4 | Dev plan doc | `docs/dev-plan.md` | this file |
| M0.5 | Optional: install Rust only when starting Tauri | system | not blocking M1 host |

**Deliverable**: clean `pnpm typecheck` / `pnpm test` on stubs.

---

### M1 — Host reality + CLI smoke (1–2 weeks)

**Goal**: actually talk to Pi (or a mocked session) through host contracts.

Spec: [`docs/specs/m1-host-cli.md`](./specs/m1-host-cli.md) · M2 design: [`docs/specs/m2-agent-window.md`](./specs/m2-agent-window.md)

| # | Task | Exit criteria | Status |
|---|------|---------------|--------|
| M1.1 | Event map Pi→AgentEvent | unit fixtures | done (code) |
| M1.2 | PermissionPolicy allow/ask/deny | golden tests | done (code) |
| M1.3 | `~/.piwin` config load/save | init/show CLI | done (code) |
| M1.4 | PiSdkAdapter + MockSession | chat --mock works | done (code) |
| M1.5 | PiRpcAdapter thin + mock | structure + spawn attempt | partial |
| M1.6 | CLI doctor/config/chat/session | e2e mock chat | done (code) |
| M1.7 | Optional real Pi dynamic import | actionable errors if missing | scaffold |

**Deliverable**: CLI chat path with `--mock`; real Pi optional via dynamic import.


---

### M2 — Agent Window MVP ✅ Done

**Goal**: Tauri shell with project + history + markdown chat.

**Record**: [`docs/specs/m2-execution-plan.md`](./specs/m2-execution-plan.md)（完成记录，不是待办队列）  
**Deferred**: [`docs/todo-deferred.md`](./todo-deferred.md)

| # | Task | Exit criteria | Status |
|---|------|---------------|--------|
| M2.1 | Tauri 2 + Vite + React scaffold | window opens | done |
| M2.2 | Host sidecar / IPC bridge | UI uses host events only | done |
| M2.3 | Project open + trust | cwd bound to sessions | done |
| M2.4 | Session list/resume/new | history panel works | done |
| M2.5 | Markdown + tools + permission modal | readable agent stream | done |
| M2.6 | Model picker + settings providers | user-configured providers | done |

**Deliverable**: Desktop can chat in a project with history (mock or real host).

---

### M3 — Media + Web tools (1–2 weeks)

**Planning:** [`docs/specs/m3-media-web.md`](./specs/m3-media-web.md) · 开源对照 [`m3-m4-opensource-notes.md`](./specs/m3-m4-opensource-notes.md)

| # | Task | Exit criteria |
|---|------|---------------|
| M3.1 | `@piwin/media` save paste under `~/.piwin/media/<session>/` | files on disk |
| M3.2 | Composer paste + thumbnail | chip removable |
| M3.3 | Native/delegated image prompt routing | native vision receives ImageContent; path text is explicit text-only fallback only |
| M3.4 | Chat image preview | bubble shows image |
| M3.5 | `web_search` + `web_fetch` tools | pluggable provider; citations in UI |
| M3.6 | Permission prompts for network tools | ask/allow/deny |

**Deliverable**: paste image + web research usable in chat.

---

### M4 — Skills + MCP panels (2 weeks)

**Planning:** [`docs/specs/m4-skills-mcp.md`](./specs/m4-skills-mcp.md)

| # | Task | Exit criteria |
|---|------|---------------|
| M4.1 | Skill registry list/enable (bundled/user/project) | panel works |
| M4.2 | Default skill set + `find-skill` / `create-skill` | bundled skills present |
| M4.3 | Marketplace source: local/git | install skill |
| M4.4 | MCP config form + raw JSON | schema validate |
| M4.5 | MCP tools exposed to host tool bridge | model can call MCP tool |
| M4.6 | CLI parity for skill/mcp list | commands work |

**Deliverable**: install skill + MCP from UI; agent can use them.

---

### M5 — Artifact HTML (2 weeks, research-backed)

| # | Task | Exit criteria |
|---|------|---------------|
| M5.1 | Port parser/security/srcdoc pure TS from openwebui_m | unit tests green |
| M5.2 | Desktop ArtifactFrame (iframe sandbox) | html fence previews |
| M5.3 | Block reasons UX | empty/too-large/external |
| M5.4 | Theme contract vars (`--piwin-artifact-*`) | dark/light sane |
| M5.5 | Height/init queue basics | no meltdown on history |

**Deliverable**: Markdown default + safe HTML artifact preview.

---

### M6 — Git + Theme + Pet (2–3 weeks)

| # | Task | Exit criteria |
|---|------|---------------|
| M6.1 | Git status/diff service | shown in UI + optional agent context |
| M6.2 | Commit graph view | readable DAG |
| M6.3 | Theme packages + switch | apply skin |
| M6.4 | `hatch-theme` skill | generate+install |
| M6.5 | Codex pet load + state mapping | import `~/.codex/pets` |
| M6.6 | `hatch-pet` skill (optional) | package writes |

**Deliverable**: differentiated product surfaces beyond plain chat.

---

### M7 — Hardening (ongoing after M2)

| # | Task | Exit criteria |
|---|------|---------------|
| M7.1 | doctor command full checks | providers, paths, pi binary |
| M7.2 | logging + redaction | no secrets in logs |
| M7.3 | Runtime Refactor Phases 1-3 | Job/Run ownership unified; RPC worker isolated; SDK/worker conformance green |
| M7.4 | performance: session list, artifact init | acceptable on large history |
| M7.5 | security review pass | permissions + CSP + path rules |

---

## 4. Suggested near-term sequence (next 10 working days)

| Day | Focus |
|-----|--------|
| D1 | Tooling + typecheck green (M0) |
| D2–D4 | Pi SDK adapter + event normalize + CLI chat (M1) |
| D5–D6 | `~/.piwin` config + dual protocol forms (backend first) |
| D7–D10 | Tauri scaffold + IPC + markdown chat MVP (M2 start) |

Parallelizable after M1:

- media package (M3) while desktop UI builds
- artifact pure TS port (M5.1) without waiting for full UI polish

---

## 5. Definition of done per milestone

- PRD items for that milestone checked
- `pnpm typecheck` + targeted tests pass
- No new AGENTS.md violations
- CLI and Desktop share host contracts (CLI may degrade UX, not invent parallel logic)
- Risks/unknowns listed if blocked on Pi API details

---

## 6. Risk register (plan-level)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pi SDK API churn | host rewrite | isolate in agent-host adapters |
| Tauri + Node host integration | desktop delay | sidecar process; CLI-first validation |
| Artifact XSS | security incident | port openwebui security tests first |
| Scope creep (pets/themes early) | delay MVP | keep M6 after M2–M5 |
| Rust not installed | blocks Tauri | install when starting M2; CLI path independent |

---

## 7. Immediate next actions (ordered)

1. Finish M0 tooling (`pnpm install`, typecheck, test runner, lint).
2. Implement M1.1–M1.2 (SDK adapter + events).
3. CLI chat smoke against a real or mock provider.
4. Only then scaffold Tauri desktop.

---

## 8. Tracking

Update this file when:

- a milestone completes (check boxes)
- ADR changes order/priority
- a task is explicitly deferred with reason

---

## 9. Implemented slices (post-M2)

### CLI structured model-selection (2026-08-01) ✅

The model-facing `questionnaire` tool is implemented as a bundled Pi Extension
using Pi-native `ctx.ui.select` / `ctx.ui.input` (ADR 0023). Desktop and CLI
share one host Extension UI bridge — no new IPC or question contract:

- Desktop reuses the existing `extension-ui-dialog`.
- `piwin chat` wires `createCliExtensionUiRequestHandler` into
  `createAgentHost({ onExtensionUiRequest })`; prompts render to stderr and
  stdout stays clean. Non-TTY sessions cancel/unavailable instead of hanging.

Slices shipped: bundled `questionnaire` extension, CLI TTY handler, `piwin chat`
wiring, docs (ADR 0023 + architecture §3.5).

# piwin Development Plan

| Field | Value |
|-------|-------|
| Status | Active — M2 done; Host Server/multi-client target added; see todo-deferred |
| Date | 2026-08-12 |
| Based on | `docs/prd.md` v0.2, locked product decisions |
| Repo | `~/Projects/piwin` |

---

## 1. Guiding principles

1. **Architecture before features**: dual-mode host + contracts stay real.
2. **Vertical slices**: each milestone ships a usable path, not only folders.
3. **Research-hard parts first enough**: artifact/media security from `openwebui_m`.
4. **Private, local-first**: one Host authority, many clients; no cloud multi-tenant work.
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
Isolation 推进。三阶段现已完成：旧的 Job/Run/process/worker 权威路径已删除，
公共 runtime replacement 也已接入；后续改动必须通过架构门禁。
原 Phase 7 worker plan 只保留为历史分析，不再是执行权威。

Agent turn 完成权威已回到 Pi native outcome。产品 Run 只由 Host
`RunRegistry` 根据 `AgentPromptOutcome` 终态一次。执行权威：

- [`docs/specs/2026-08-27-pi-native-turn-authority-refactor.md`](./specs/2026-08-27-pi-native-turn-authority-refactor.md)

确定性路径已落地（contracts / agent-host / host-runtime / Desktop / CLI）。
旧 Host watchdog、identity-less error reclaim、全局 retry 清零、agent-host
event envelope 已删除。用户批准的 CPA/Grok 实网冒烟仍待做。

### 1.2 Host Server / multi-client architecture program

The Host-first deployment target is defined by:

- [`docs/adr/0036-host-server-multi-client-deployment.md`](./adr/0036-host-server-multi-client-deployment.md)
- [`docs/specs/host-server-multi-client.md`](./specs/host-server-multi-client.md)

The order is fixed: make the contracts and replay/auth seams truthful, extract
the reusable HostClient/transport surface, ship a standalone local Host Server,
then validate private multi-client connectivity. Gateway/tunnel and mobile/Web
shells follow the Host protocol; they are not parallel execution paths.

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

**Completed slice (ADR 0043):** Native model search routing and video model discovery.
- Web Settings exposes the search route policy and a live route preview.
- Model add/edit supports the `native-web-search` capability and badge.
- Host Runtime resolves exactly one search backend per generation; native
  selected omits `web_search`, external selected omits provider-native fields.
- SDK/RPC production registrations wrap Pi's real lazy provider stream so the
  selected native route changes the outbound request, not only the blueprint.
- Native citation parsing, `message/search_evidence`, transcript persistence,
  and Desktop rendering are present, but Pi 0.80.10 does not expose provider
  grounding metadata to the adapter; Settings reports citation support as
  unavailable instead of claiming full readiness.
- Web Settings can select a separate configured `native-web-search` model as
  the exclusive backend for the Host `web_search` tool. Host keeps credentials
  private, ignores ordinary sources while delegated, and fails closed for a
  stale or unsupported selection.
- Video Settings discovers provider video models, separates recognized and suggested models, and prefills the route.
- Verification: `pnpm typecheck && pnpm test && pnpm test:architecture && pnpm --filter @piwin/desktop build`.
  - Latest run (2026-08-11): typecheck, architecture boundaries, Desktop build,
    and all native/delegated search target suites pass. The latest full
    `pnpm test` run completed all 1,179 Desktop assertions but exited non-zero
    because `MarkdownView.test.tsx` left three React scheduler callbacks after
    environment teardown (`window is not defined`); this is outside the search
    slice. A separate Plan Run cancellation timing failure from the preceding
    run passed immediately when rerun in isolation.
- See `docs/adr/0043-native-model-search-routing.md` for the architecture decision.

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
| M7.3 | Runtime Refactor Phases 1-3 | done — Job/Run ownership unified; RPC worker isolated; SDK/worker conformance green |
| M7.4 | performance: session list, artifact init, renderer egress/transcript bounds | bounded mounted turns and acceptable native memory slope on large history |
| M7.6 | Host session runtime residency (ADR 0040 WP0–WP8) | cold history free; idle TTL/LRU/memory eviction; generation-scoped ids; Desktop/CLI visibility; SQLite transcript store + doctor metrics |
| M7.7 | Session cold storage (ADR 0044 R1) | manual pack / plan+confirm offload / restore; journal recovery; Desktop restore-first; doctor + `pnpm test:cold-storage` |
| M7.5 | security review pass | permissions + CSP + path rules |

### M8 — Host Server + multi-client deployment (next architecture slice)

**Goal**: run one Host locally or on another private machine and connect more
than one shell to the same sessions, Runs, Jobs, MCP supervisor, and data root.

| # | Task | Exit criteria | Status |
|---|------|---------------|--------|
| M8.1 | Host target/config contracts | protocol/client hello and safe Host capability status are normalized; persistent target config remains | partial |
| M8.2 | Sequenced push/replay truth | Host instance identity, seq cursor, replay-too-old, snapshot frame, and reconnect replay have conformance tests | partial |
| M8.3 | Host-side client identity/policy | client identity, token auth, safe command allowlist, and path redaction are active; pairing/revocation remains | partial |
| M8.4 | Extract HostClient/transport packages | public HostClient/transport packages serve mobile and fake-server tests; Desktop/CLI migration remains | partial |
| M8.5 | Standalone Host Server | `apps/host` runs without Tauri and serves loopback/private WebSocket through HostRuntime | done — initial slice |
| M8.6 | Private multi-client smoke | fake/runtime-port smoke covers two clients, safe reads, push and reconnect replay; real two-shell prompt smoke remains | partial |
| M8.7 | Optional Gateway/tunnel | relay is transport-only, redacts secrets, and is not required for Tailscale/private LAN | planned |
| M8.8 | Mobile/Web shell spike | client shell consumes Host protocol after M8.6; no independent Agent loop | in progress — status/list/chat plus in-tree flashcard catalog/study (ADR 0066; real-device V04/V09/V22 not run) |
| M8.9 | Conversation multi-pane live set (ADR 0063) | Desktop general scope has device-local 1/2/4/8 panes; one deduplicated remote subscription keeps all visible Chats live; Project Agent remains single-stage | done |

### M9 — piwin Live (Provider Registry + work-session delegation)

**Goal**: Desktop speak/listen/interrupt bound to one work session. First-period
channels: **openai-codex** OAuth and **Gemini API key**. Host owns the call;
Desktop owns media by `mediaDriverId`. Delegation → Session/Run/Permission
(ADR 0065).

Specs: [product](./specs/2026-08-28-codex-live-product.md) · [tech](./specs/2026-08-28-codex-live-voice-lane.md) · [provider adapter](./specs/2026-08-29-live-provider-adapter.md) · [plan](./plans/2026-08-28-piwin-live-execution-plan.md)

| # | Task | Exit criteria | Status |
|---|------|---------------|--------|
| M9.0 | WP0 docs/ADR/architecture/PRD sync | 双登记台；长期凭证不离 Host，一次性 owner token 例外 | in progress |
| M9.1 | WP1 双渠道 spike | Codex intelligence 证据或隐藏字段；Gemini constrained token + PCM Go/No-go | planned |
| M9.2 | WP2–WP5 contracts + registry + Codex 迁移 | Codex 设置/建连/委派回归绿 | planned |
| M9.3 | WP6–WP7 Gemini adapter + Desktop Driver + 设置 UI | 两家可选、失败自关 | planned |
| M9.4 | WP8–WP9 transport/hardening + 验收 | §11 自动化与 native matrix | planned |

**Out of M9:** Platform Realtime `realtime-audio` 目录、Host PCM 中继、非 Desktop 持麦、关键词委派。

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

### 4.1 Next architecture slice

Before starting a mobile/Web UI, complete the M8.1–M8.6 vertical slice:

1. Contract and status truth (`HostInstanceId`, protocol version, Host target,
   caller/device context).
2. HostRuntime sequencing, bounded replay, snapshot hydration, and idempotent
   request/run handling.
3. Public HostClient/transport package with local JSONL and loopback WebSocket.
4. Standalone Host Server entry point using the existing HostRuntime composition
   root.
5. Two-client integration test against one Host data root.

Only after that slice is green should Gateway/tunnel or a mobile shell be
implemented.

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
| Multiple Host instances share one data root | divergent Runs/sessions/MCP state | one Host authority per root; clients attach through Host Server |
| Remote reconnect loses or duplicates work | unsafe prompt retry / stale UI | Host instance identity, idempotent commands, replay-or-snapshot contract |
| Private tunnel mistaken for authorization | remote overreach / secret exposure | Host-side device identity and command policy; Gateway transport-only |

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

### Inline subagent conversation blocks (2026-08-12) ✅

ADR 0046 is implemented: model delegations render at their causal parent tool
position, invocation lifecycle is revisioned and durable, stale children are
reconciled after Host restart, and the child window shares the normal
transcript/tool/permission/file presentation. Terminal children support
same-session follow-up and explicit worktree apply/retain/discard. The old
composer Working dock was removed. Project-row creation carries explicit scope;
historical mis-scoped sessions can be copied safely with **Continue in
project…** instead of being silently rewritten.

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

### Flashcard study workbench (2026-08-30) — in tree, not device-verified

ADR 0066: Host-owned rounds, operation log, additive `ReviewState.revision`.
Desktop study page, Mobile catalog + study, CLI `piwin study`, existing
`fcws-tear-off` 200ms, unique CardStore.

**Do not mark shipped / Accepted.** Real-device V04/V09/V22 not run (iOS sim
Shutdown; no `adb`; no Android gen). Visual fixtures not captured. Root
`pnpm typecheck` / mobile build still fail on pre-existing `@piwin/artifact`
errors. Desktop Vite build passes via `@piwin/flashcards/study-sequence`.

Intentional v1 boundaries: Mobile source preview is excerpt-only; study is
online-only; CLI has no animation. Compatibility: old Markdown not migrated;
missing ReviewState revision = 0; `study/` dirs lazy-created. Rollback:
reverting frontend entries must not delete rounds/operations; do not run an
old Host against an unapplied new log; backup `~/.piwin/flashcards` first.

Spec: [`2026-08-30-flashcard-review-workbench-spec.md`](./specs/2026-08-30-flashcard-review-workbench-spec.md).
Delivery: [`2026-08-30-flashcard-review-workbench-delivery.md`](./evidence/2026-08-30-flashcard-review-workbench-delivery.md).
Architecture: §2.0.2.

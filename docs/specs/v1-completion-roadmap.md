# piwin v1 Completion Roadmap

| Field | Value |
|---|---|
| Status | Active execution roadmap |
| Date | 2026-07-20 |
| Canonical backlog | [`todo-deferred.md`](../todo-deferred.md) |
| Scope | Complete the PRD v1 features after the M2 Agent Window MVP and M3/M4 package-plus-CLI kernels |

## 1. Purpose and rules

This document turns the remaining PRD work into an execution order. It is not a second backlog:

- `docs/todo-deferred.md` is the single canonical task list and completion archive.
- Each phase below starts with contracts, then package logic, host integration, desktop/CLI surfaces, tests, and documentation.
- A phase is only complete when its stated acceptance checks pass. No feature is marked done based only on scaffolding.
- The dependency direction and security constraints in `AGENTS.md` remain binding. In particular, desktop UI never accesses the filesystem or Pi directly.

## 2. Verified baseline

| Area | Status | Evidence |
|---|---|---|
| M2 Agent Window | Complete | Tauri sidecar transport, trust, session index, Markdown stream, tool cards, permission modal, model settings |
| M3 kernel and CLI | Complete, desktop surface pending | `media`, `tools-web`, CLI `chat --image`, config defaults, host web-tool registration attempt |
| M4 kernel and CLI | Complete, desktop surface and live bridge pending | `skills`, `mcp`, `marketplace`, CLI skill/MCP commands, bundled skills |
| Host dual modes | SDK usable; RPC partial | normalized contracts exist; RPC lacks full persistent session parity |

## 3. Execution order

```text
P0 contracts + host capability completion
  -> P1 desktop Media / Web / Skills / MCP vertical slices
  -> P2 safe HTML Artifact runtime and desktop renderer
  -> P3 Git status, diff, and commit graph
  -> P4 Theme packages and desktop application
  -> P5 Pet packages and agent-state animations
  -> P6 cross-cutting hardening, E2E, release readiness
```

P0 and P1 are the critical path because they finish requirements already partially implemented in M3/M4. P2 through P5 are independent product packages after their shared desktop capability shell exists. P6 runs continuously but has final exit checks.

## 4. Phase P0 - Complete host capabilities and contracts

### P0.1 Media IPC and prompt attachment ownership

**Why first:** the desktop must not call filesystem APIs and must not construct model-facing image prompt text itself.

| Layer | Work |
|---|---|
| contracts | Add typed HostCommand/HostResponse payloads for media save/remove/list and attachment-aware prompts. IPC bytes may be base64 only in transit; persisted media remains the source of truth and base64 never enters model context. |
| agent-host | Handle media commands with `@piwin/media`; enrich text-only prompts with `formatTextModelImageInjection`; preserve attachment metadata for UI history. |
| desktop | Use HostClient to save a pasted/dropped file and receive a `SavedMediaAsset`; no direct filesystem access. |
| tests | Media command round-trip, max-size/mime rejection, prompt path injection, traversal rejection. |

**Exit:** Desktop can paste or drop an allowed image, remove its chip, send it, and see an image preview; text models receive only the absolute path metadata.

### P0.2 Network permission lifecycle

| Layer | Work |
|---|---|
| contracts | Give tool-originated permissions a stable request id, action (`web_search` / `web_fetch`), domain/detail, and resolution payload. |
| agent-host | Route web tool execution through the existing policy and pending-permission resolver. Block execution until a deny/allow decision or abort. Persist allowed policy only through a documented project policy store. |
| desktop | Reuse the existing permission modal for network requests and show the requested URL/domain. |
| tests | Allow, deny, abort, timeout, project-remember, and blocked-domain golden cases. |

**Exit:** no web search/fetch reaches the network while a request is denied or unresolved.

### P0.3 MCP live tool bridge spike and implementation

Before changing behavior, record the current Pi custom-tool API in **ADR 0008**. The bridge must use Pi's supported session creation/custom-tool option when available; post-creation monkey-patching is only a temporary compatibility fallback and must report unsupported capability explicitly.

| Layer | Work |
|---|---|
| contracts | Add MCP health, tool inventory, tool invocation, and lifecycle result types to the normalized host boundary. |
| mcp | Keep validated Cursor/Claude-compatible config, use the official MCP SDK transport/client, manage client lifetime per host session, list/call tools, namespace names. |
| agent-host | Start enabled clients, expose validated tools through Pi's supported API, forward calls, apply network/process permission policy, close clients on session/host dispose. |
| desktop/CLI | Show health and tools inventory; surface actionable startup errors without exposing environment values. |
| tests | Fixture MCP server for initialize/list/call, crash behavior, disabled server, name collision, process cleanup. |

**Exit:** an enabled stdio MCP server is visible in Desktop and CLI; a real Pi session can call a namespaced MCP tool; shutdown closes its process.

### P0.4 Skills lifecycle completion

| Layer | Work |
|---|---|
| skills | Validate frontmatter and update enabled-state persistence; merge bundled/user/project/mapped locations deterministically. |
| marketplace | Local/git install reports source provenance and never escapes the piwin skills root. |
| agent-host | Pass enabled paths to Pi using the verified resource-loader API, not an undocumented option alone. |
| tests | Collision precedence, malformed frontmatter, disable persistence, source traversal, Pi resource mapping fixture. |

**Exit:** disabled skills are absent from a new agent session and enabled project/user skills are discoverable by Pi.

## 5. Phase P1 - Finish the M3/M4 desktop product surfaces

### P1.1 Composer media and message previews

- Clipboard paste and drag/drop create pending attachment chips.
- Chips show filename, mime, size, thumbnail, and remove affordance.
- Sent and historic messages render only media paths approved by the media service via Tauri's scoped asset protocol.
- Local path strings from arbitrary model output never become unrestricted `file:` URLs.

### P1.2 Web configuration and citations

- Add web provider/config fields to Settings.
- Show search and fetch tool results as citation cards with safe external-link handling.
- Expose the network permission request UI from P0.2.

### P1.3 Skills panel

- List grouped skill sources with search, validation failures, enabled state, and scope.
- Install from local directory or explicit git URL; show a static recommended-source list only, not a custom registry.
- Make enable/disable write config through host commands, then restart or refresh the affected session with an explicit notice.

### P1.4 MCP panel

- Server list with enabled state, command/args (but never resolved secret values), health, and tool inventory.
- Form editor and raw JSON editor use the same validation/save API.
- Start/stop/retry states follow host lifecycle results; no renderer process spawns a server.

**P1 exit:** all M3/M4 PRD requirements work end-to-end from Desktop and retain CLI parity.

## 6. Phase P2 - Safe HTML Artifact capability

> Status: **Polish complete** 2026-07-20 — core + A0–A6 polish (D-ART-01..04).
> Plan: [`docs/plans/2026-07-20-p2-artifact-polish.md`](../plans/2026-07-20-p2-artifact-polish.md)

**Done:**
- parser / security / strict CSP srcdoc / iframe policy / evaluate
- height postMessage bridge (`piwin-artifact:ready|resize`) + height-policy
- init queue (MAX_CONCURRENT=1) before srcdoc assignment
- streaming open-fence + streamable preview (scripts/handlers stripped)
- theme-contract soft-repair (preview only; raw source in details)
- active theme → artifact CSS vars mapping in Desktop

**Still deferred (D-ART-05..08):** lazy eviction, expanded height >900, runtime embed reporter, hard theme block.

**Acceptance:** Markdown default; sandboxed offline-by-default preview; block reasons for empty/oversize/external; content-driven height; staggered history init; mid-stream safe preview; soft theme repair; raw source details unchanged.

## 7. Phase P3 - Git product capability

> Status: **Implemented (read + write core)** 2026-07-20 — modular `@piwin/git` reads + stage/unstage/commit/branch/checkout (confirm UI; no force-push). Complex DAG viz still open.

| Slice | Package responsibility | Desktop surface |
|---|---|---|
| Repository probe | `@piwin/git` resolves git root, branch, dirty state, ahead/behind | project header/status panel |
| Diff summary | bounded changed-files and stat model | expandable change list |
| Commit graph | normalized graph nodes/edges and commit details | separate graph panel, never confused with agent session tree |
| Mutating actions | policy-gated stage/commit/branch after read-only slices prove stable | explicit confirmations |

**Acceptance:** opening a trusted git project shows status and bounded diff data; graph can select a commit and display its details.

## 8. Phase P4 - Theme capability

> Status: **Implemented (core)** 2026-07-20 — token theme packages under `~/.piwin/themes`, validate/install/list/set-active, Desktop ThemePanel. `hatch-theme` skill still open.

- Define a portable theme manifest and token contract in `@piwin/theme`.
- Validate/install themes under `~/.piwin/themes`; keep UI application in desktop only.
- Add Settings theme preview and switcher; make artifact theme variables derive from the same tokens.
- Ship `hatch-theme` only after the validator and install path exist.

**Acceptance:** switching an installed theme updates desktop and artifact tokens without arbitrary CSS/JS execution.

## 9. Phase P5 - Pet capability

> Status: **Implemented (core)** 2026-07-20 — `@piwin/pet` validate/store/import, IPC, Desktop companion + panel, hatch-pet skill.

**Done:**
- Codex-compatible `pet.json` + spritesheet validator
- `~/.piwin/pets` list/install/set-active; scan `~/.codex/pets`, select one or more packages, and import by copy; concrete package paths remain supported
- AgentEvent → pet animation state (`idle|running|waiting|failed|…`)
- Desktop `PetCompanion` spritesheet animator + `PetPanel`
- Pet list cards preview each package's actual first atlas frame instead of a generic dog placeholder
- Bundled `piwin-default` pet + `skills/hatch-pet`

**Acceptance:** valid pet animates from agent state; invalid packages surface validation errors.

## 10. Phase P6 - Hardening and release readiness

> Status: **Main-path complete** 2026-07-20 — M1–M5 of
> [`docs/plans/2026-07-20-p6-main-path-completion.md`](../plans/2026-07-20-p6-main-path-completion.md).
> Remaining items are polish residuals in `todo-deferred.md` (not main path). Executable residual plan: [`docs/plans/2026-07-20-residual-execution.md`](../plans/2026-07-20-residual-execution.md).

| Area | Status |
|---|---|
| Bash hard-gate | **Done** — Pi bash overridden with permission-gated tool |
| SSRF depth | **Done** — DNS private IP + redirect revalidate + stream cap |
| Project network remember | **Done** — Allow for project stores hosts/search in projects.json |
| File-picker attach | **Done** — Desktop Attach image |
| Session transcript resume | **Done** — product `transcript.json` + `session/messages` + hydrate UI |
| MCP lifecycle | **Done** — host manager status/start/stop + Desktop controls |
| MCP single process owner + official SDK client | **Done** — manager share + dual transport (D-MCP-02b/04) |
| MCP project-remember connect | **Done** — `ProjectMcpPolicy` (D-MCP-02d); residual tool-call remember D-MCP-02d-tool |
| Session list + linear outline | **Done light** — preview/count/time + jump outline (D-M2-02) |
| Pi JSONL tree resume | **Deferred** — ADR 0009 product shell only (D-M2-01b) |
| RPC honesty | **Done bounded** — clear failure + capabilities.customTools (D-HOST-01) |
| Provider validation + secret refs MVP | **Done** — no raw keys; env + optional keychain (D-HOST-02, D-M2-04) |
| Doctor main-path matrix | **Done** — providers key status, mcp health, skills, themes/pets |
| Host e2e smoke | **Done** — `pnpm e2e:smoke` in CI (D-M2-05); Tauri UI driver residual D-M2-05b |
| Dependency policy | **Done light** — `docs/dependency-policy.md` + report-only audit (D-ENG-02) |
| Desktop package path | **Done unsigned** — `pnpm package:desktop` + `docs/release-desktop.md` (D-ENG-03); signing D-ENG-03b |
| Full Pi JSONL tree / multi-branch UI | Residual — D-M2-01b, D-M2-02-full |
| Signed/notarized release | Residual — D-ENG-03b |

**Exit (main path):** clean checkout installs, typechecks, tests, host smoke, doctor matrix, and
documented unsigned desktop package. Signing and Pi multi-leaf tree remain residual.

## 11. Delivery discipline

For each phase:

1. Create/refresh the phase spec and any ADR required by a boundary or protocol decision.
2. Implement one vertical slice at a time with focused tests.
3. Run targeted tests/typechecks during development and full repository verification at phase completion.
4. Move completed rows from the canonical backlog to its Done archive with date and evidence.
5. Do not start a later phase merely because a package skeleton exists.

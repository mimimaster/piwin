# AGENTS.md — working rules for piwin

> This file is binding for humans and coding agents.
> If a change violates these rules, reject it and fix the design first.

## 0. Product one-liner

piwin is a **private** coding-agent **shell** on Pi:

- Client shells: Desktop (Tauri 2) + CLI today; Windows/mobile/Web later
- Host: deployable Node service — local sidecar or private remote machine
- CLI: same Host/config/session authority as Desktop when attached to one Host
- Kernel: Pi (`SDK` + `RPC` dual mode); config root: `~/.piwin`

Read first: `docs/prd.md`, `docs/architecture.md`, `docs/artifact-research.md`, `docs/adr/*`, `docs/dev-plan.md`.

---

## 1. Non-negotiable architecture rules

1. **UI/apps never import Pi packages** (`@earendil-works/pi-*`) — public `@piwin/*` only.
2. **Only `packages/agent-host` may depend on Pi.**
3. **Contracts first**: new cross-cutting capability starts in `packages/contracts`.
4. **Adapters over forks**: do not fork Pi core to add product features.
5. **Artifact**: port pure TS from `openwebui_m`; never paste Svelte into packages.
6. **Images for models**: paste/drop → save under `~/.piwin/media/` → pass as native `ImageContent` to Pi `prompt(text, { images })`. No path strings or base64 in the *text* prompt by default (path injection only as fallback for text-only models).
7. **One config root**: product state under `~/.piwin`; Pi native under `~/.pi/agent`.
8. **Dual host modes stay real**: `PiSdkAdapter` + `PiRpcAdapter` implement the same contracts.
9. **No circular deps**: dependency direction is one-way downward (see §2).
10. **No "temporary" cross-layer hacks** that become permanent — prefer a small contract over a clever shortcut.
11. **One composition root**: `@piwin/host-runtime` composes application services + `@piwin/agent-host`; agent-host stays a Pi-only backend boundary.
12. **Host-first deployment**: one Host authority (`HostCommand`/`HostPush`); multiple shells connect to it.
13. **Gateway is transport-only**: never imports Pi, executes Host tools, owns sessions, or stores provider secrets.

---

## 2. Package dependency graph (enforce)

```text
apps/desktop, apps/cli
    ↓
packages/host-runtime        ← product composition root
    ├──→ application packages (session, project, skills, mcp, media, artifact, git, process, browser, tools-web)
    └──→ packages/agent-host ← only place that may import Pi
application packages ──→ packages/contracts
packages/agent-host ─────→ packages/contracts
packages/contracts           ← leaf: no runtime deps on other @piwin/*
    ↓
Node/OS/Pi (host only)
```

Target multi-client adds: `apps/* → @piwin/host-client / host-transport → @piwin/contracts`; `apps/host → @piwin/host-server → @piwin/host-runtime`; optional `apps/gateway → host-transport + contracts only`.

**Forbidden edges** (everything else): `apps/*` → raw Pi; application packages → `host-runtime`/`agent-host`; `agent-host` → application packages (inject ports from host-runtime); `contracts` → any `@piwin/*`; `ui-kit`/`artifact` → host/Node/DOM APIs (keep UI pure, runtime portable); deep relative imports into another package `src/` (public exports only — `src/index.ts`).

---

## 3. Code standards (anti-shitpile)

### 3.1 Language & style

- TypeScript **strict** (`tsconfig.base.json`); never weaken `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` without ADR.
- ESM only (`"type": "module"`); `.js` extensions in relative imports (NodeNext); `import type` for types.
- No `any` (isolate behind a named type + why + TODO); no `!` without a runtime check in the same block; prefer `unknown` + narrowing.
- Functions are verbs, types are nouns; no 1–2 char names; one primary export per file; comments explain **why / invariants**, not "set x to y".

### 3.2 Reuse & file size

- **Reuse before writing** — check in order: 1) same package public API → 2) other `@piwin/*` (respecting §2) → 3) `@piwin/ui-kit` primitives → 4) stdlib / existing deps → 5) new code in a named domain module. **Extract before duplicating**: logic appearing in two places becomes a shared module — copy-paste is a violation.
- **UI**: Desktop uses `@piwin/ui-kit` (Mantine through its integration) for buttons, dialogs, menus, toasts, etc. A genuinely missing primitive is added deliberately to `ui-kit`, never hand-rolled or locally forked in an app. Custom CSS only for product-specific layout/theme.
- **Hard cap: 1000 lines** for *any* source file (`.ts`/`.tsx`/`.rs`/`.css`…). Split **by responsibility** (parse vs policy vs I/O; state vs view vs effects) *before* adding code to an oversized file — a 900-line file spanning responsibilities is still a violation, not "within cap".
- **Proactive trigger: ~400 lines** — plan the split when approaching it; the cap is a ceiling, not a goal.
- **Layout**: `packages/<name>/src/index.ts` (public exports only) + implementation; tests colocated (`foo.test.ts`) — pick one convention per package. No `utils.ts` dumping grounds; name by domain (`permission-policy.ts`, `session-index.ts`).

### 3.3 Errors, async, events, state

- `Error` subclasses with stable `name` at host/RPC boundaries; never swallow errors — log at boundary or rethrow; user-facing messages ≠ stack traces (map at app/host edge); `await` or explicitly void — no floating promises.
- Abort paths for long operations (prompt, fetch, tool runs); `subscribe` returns explicit unsubscribe.
- Adapters translate Pi SDK/RPC payloads → normalized `AgentEvent` only; UI never parses Pi-native shapes. Product transport uses `HostPush` — agent/event is one variant among Job/Run/Plan/subagent/browser/permission/diagnostic pushes, not fake Pi events.
- Pure logic stays pure and unit-tested; FS/process/network live in dedicated services (`media`, `process`, `mcp`, `browser`, `tools-web`) composed by host-runtime; UI never calls `fs`/`child_process`.

### 3.4 Security

- Model output and artifact HTML are **untrusted**: sandbox iframe + CSP, block external resources by default.
- Never log API keys; prefer env/keychain refs in config.
- Permission policy: layered rule engine with `auto`/`ask-all`/`bypass` + file-write gate (ADR 0019; see [Permissions guide](./docs/guides/permissions.md)) — not an OS sandbox.
- MCP is outside the permission layer entirely (ADR 0033): servers run with Host user's OS permissions; legacy MCP rules in `permissions.json` silently ignored; user owns MCP risk.
- Media paths stay under `~/.piwin/media/` (no traversal).

### 3.5 Testing

| Change type | Required tests |
|-------------|----------------|
| Pure function / policy | unit tests |
| contracts type change | update all implementers; typecheck green |
| adapter event mapping | fixture-based unit/integration |
| security classifier | golden cases for allow/block |
| UI only | manual OK early; e2e later for critical paths |

No "logic changes" merged with zero tests when the package has a test runner.

### 3.6 Git / PR hygiene

- Small commits by concern; no `node_modules`, secrets, `.env`, large media binaries.
- One feature vertical slice per PR; refactors in separate commits, never mixed with behavior changes.

### 3.7 Naming

| Kind | Convention | Example |
|------|------------|---------|
| packages | `@piwin/<kebab>` | `@piwin/agent-host` |
| files | `kebab-case.ts` | `create-host.ts` |
| types/interfaces | `PascalCase` | `SessionHandle` |
| React components (later) | `PascalCase.tsx` | `AgentWindow.tsx` |
| constants | `SCREAMING_SNAKE` | `DEFAULT_MAX_ARTIFACT_BYTES` |
| ADR files | `docs/adr/NNNN-title.md` | `0003-dual-mode-host.md` |

### 3.8 Done checklist

1. `pnpm typecheck` green; 2. tests pass for touched packages; 3. public exports updated intentionally; 4. docs/ADR updated if architecture or user-visible behavior changed; 5. no new dep without justification; 6. no file over 1000 lines — verify with a line-count check; 7. reuse before writing (§3.2).

---

## 4. Feature playbook (how to add anything)

> **Everything lands on disk** — plans, specs, ADRs go to `docs/plans/`, `docs/specs/`, `docs/adr/`. Nothing exists only in chat.

1. **Spec** — covered by PRD/dev-plan? If architectural, write/update ADR.
2. **Contracts** — add/change types in `@piwin/contracts` if cross-boundary.
3. **Package** — implement in the owning package only.
4. **Host wiring** — compose through `@piwin/host-runtime`; agent-host only for Pi backends and Pi event/tool adaptation.
5. **App** — CLI and/or Desktop consume public APIs only.
6. **Verify** — typecheck + tests + manual smoke listed in PR/notes.

### Package ownership cheat sheet

| Want to change… | Touch |
|-----------------|-------|
| Session tree / history index | `session` |
| Open project / trust | `project` |
| Skills install/list | `skills` + `marketplace` |
| MCP JSON / servers | `mcp` |
| web_search / web_fetch | `tools-web` |
| HTML artifact policy | `artifact` (+ research doc) |
| Paste image / media store | `media` + `host-runtime` PromptPreparation; `agent-host` applies native image input to Pi |
| Job / Run / scheduling authority | `host-runtime` + owning application package |
| Pi SDK/worker session backend | `agent-host` |
| Shared types | `contracts` |
| Desktop chrome | `apps/desktop` + `ui-kit` |
| CLI commands | `apps/cli` |

---

## 5. Anti-patterns (ban list)

Standalone bans (not already stated in §1–§3):

- Silent `catch (e) {}`
- Adding Electron "just for now" when Tauri is decided
- Implementing features only in Desktop while CLI/host stay inconsistent (document intentional CLI degradation)
- Drive-by dependency upgrades unrelated to the task

Rule violations disguised as "temporary" (see §1–§3): god modules/`utils.ts` dumps, files over 1000 lines, copy-paste reuse avoidance, UI importing Pi, base64 in text prompts, config only in `~/.pi`, openwebui Svelte copied into packages.

---

## 6. Environment expectations

- Node `>= 20` (tested on 24+); pnpm `9.x` (see root `package.json`); TS project references/workspace packages; Rust later for Tauri (not blocking CLI/host).

Bootstrap:

```bash
cd ~/Projects/piwin
pnpm install
pnpm typecheck
pnpm test
pnpm dev:cli
```

---

## 7. Agent operating notes

1. Read this file + relevant docs before large changes; prefer minimal diffs that preserve architecture boundaries.
2. New top-level folders require architecture doc updates.
3. Keep stubs compiling: `throw new Error('not implemented yet')` over fake success.
4. Record ADRs when changing dual-mode host, config root, protocols, or artifact/media model.
5. Follow §3.2 before writing: check the file's line count, reuse first, split by responsibility — structure optimization is part of done, not deferred cleanup.

---

## 8. Terminology & Domain Disambiguation

- **`WalkthroughArtifact` (Walkthrough)**: User-facing, evidence-driven delivery report (`sessionId + messageId` bound). Generated asynchronously by Host via non-streaming provider completion. Displayed as Markdown card under assistant message.
- **`PlanExecutionSummary` (Plan Summary)**: Internal structured data object tracking plan step status (`completedStepIds`, `failedStepIds`, `mergedChildSessionIds`, etc.). Used internally by Host during plan execution orchestration; not a user-facing document.
- **`SessionPlan`**: Structural plan representation in the plan domain (`id`, `title`, `steps`, `status`).

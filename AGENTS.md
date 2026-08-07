# AGENTS.md — working rules for piwin

> This file is binding for humans and coding agents.
> If a change violates these rules, reject it and fix the design first.

## 0. Product one-liner

piwin is a **private** coding-agent **shell** on Pi:

- Desktop: Tauri 2
- CLI: same host/config as desktop
- Kernel: Pi (`SDK` + `RPC` dual mode)
- Config root: `~/.piwin` (maps/overlays Pi resources; does not own Pi upgrades)

Read first:

- `docs/prd.md`
- `docs/architecture.md`
- `docs/artifact-research.md`
- `docs/adr/*`
- `docs/dev-plan.md`

---

## 1. Non-negotiable architecture rules

1. **UI/apps never import Pi packages** (`@earendil-works/pi-*`).
   - Apps may import public `@piwin/*` packages only, never raw Pi packages.
2. **Only `packages/agent-host` may depend on Pi**.
3. **Contracts first**: new cross-cutting capability starts in `packages/contracts`.
4. **Adapters over forks**: do not fork Pi core to add product features.
5. **Artifact**: port pure TS from `openwebui_m`; never paste Svelte components into packages.
6. **Images for models**: paste/drop → save under `~/.piwin/media/` → pass as native image content (`ImageContent`) into Pi `prompt(text, { images })`. Do **not** inject path strings into prompt text by default. Do **not** dump base64 into the *text* prompt. Path-string injection is a fallback only (e.g. text-only models without vision delegation / extension), not the default.
7. **One config root**: product state under `~/.piwin`; Pi native under `~/.pi/agent`.
8. **Dual host modes stay real**: `PiSdkAdapter` + `PiRpcAdapter` implement the same contracts.
9. **No circular package deps**. Dependency direction is one-way downward (see §2).
10. **No "temporary" cross-layer hacks** that become permanent. Prefer a small contract over a clever shortcut.
11. **One product composition root**: `@piwin/host-runtime` composes application services and `@piwin/agent-host`; `agent-host` stays a Pi-only backend boundary.

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
packages/contracts           ← no runtime deps on other @piwin/*
    ↓
Node/OS/Pi (host only)
```

### Allowed

| From | To |
|------|----|
| `apps/*` | any `@piwin/*` except raw Pi |
| `@piwin/*` (not contracts) | `@piwin/contracts` |
| `@piwin/host-runtime` | application packages + `@piwin/agent-host` + `@piwin/contracts` |
| `@piwin/agent-host` | `@piwin/contracts` + `@earendil-works/pi-*` |
| `@piwin/ui-kit` | `@piwin/contracts` only (no host, no FS) |

### Forbidden

| From | To | Why |
|------|----|-----|
| `apps/*` | `@earendil-works/pi-*` | breaks host boundary |
| application packages | `@piwin/host-runtime`, `@piwin/agent-host` | composition and Pi dependencies point downward from the root |
| `@piwin/agent-host` | application packages such as `process`, `mcp`, `browser`, `media` | keep the Pi boundary backend-only; inject ports from host-runtime |
| `packages/contracts` | any `@piwin/*` | contracts must stay leaf |
| `packages/ui-kit` | `agent-host`, `media` FS, Node-only | keep UI pure |
| `packages/artifact` | Svelte / React / DOM host APIs | runtime must stay portable |
| any package | deep relative imports into another package `src/` | use package public exports only |

Public API = package `src/index.ts` (and explicitly exported subpaths if added later).

---

## 3. Code standards (anti-shitpile)

### 3.1 Language & style

- TypeScript **strict** (`tsconfig.base.json`). Do not weaken `strict`, `noUncheckedIndexedAccess`, or `exactOptionalPropertyTypes` without ADR.
- ESM only (`"type": "module"`). Use `.js` extensions in relative imports for NodeNext.
- Prefer `type` imports for types (`import type { ... }`).
- No `any`. If unavoidable, isolate behind a named type + comment **why** + issue/TODO.
- No non-null assertion (`!`) except after an explicit runtime check in the same block.
- Prefer `unknown` + narrowing over `any`.
- Functions are verbs; variables/types are nouns. Avoid 1–2 character names.
- Keep files focused: one primary export concept per file when practical.
- Comments explain **why / invariants / non-obvious constraints**, not "set x to y".

### 3.1.1 UI component reuse

- Unless the user explicitly requests a custom UI treatment, prefer the already-introduced public component libraries and shared components over hand-written UI primitives.
- In Desktop, use `@piwin/ui-kit` first; use its exported components and styles for buttons, inputs, dialogs, menus, notices, toasts, cards, and other common controls. Reuse Mantine primitives through the existing UI-kit integration where appropriate.
- Do not create a one-off button, modal, toast, alert, input, dropdown, or similar primitive in an app package merely to avoid using an existing component. If a reusable primitive is genuinely missing, add it deliberately to `@piwin/ui-kit` and expose it through the package public API.
- Custom CSS should be limited to product-specific layout, theme, and interaction requirements. Do not restyle or fork a shared primitive locally without a clear product reason.

### 3.2 File & module layout

```text
packages/<name>/
  package.json
  tsconfig.json
  src/
    index.ts          # public exports only
    *.ts              # implementation
  src/**/*.test.ts    # unit tests colocated OR tests/ — pick one per package and stay consistent
```

- Default: **colocated** `foo.ts` + `foo.test.ts`.
- Do not create `utils.ts` dumping grounds. Name by domain: `permission-policy.ts`, `session-index.ts`.
- Max rough guide: if a file exceeds ~400 lines, split by responsibility before adding more features.

### 3.3 Error handling

- Throw `Error` subclasses with stable `name` for host/RPC boundaries where useful.
- Never swallow errors silently. Log at boundary with context, or rethrow.
- User-facing messages ≠ internal stack traces. Map at app/host edge.
- Async: always `await` or explicitly void with comment; no floating promises.

### 3.4 Async, events, streams

- Adapters translate Pi SDK / RPC payloads → normalized `AgentEvent` only. UI never parses Pi-native event shapes.
- Product transport uses `HostPush`: Agent execution is an `agent/event` variant; Job, Run, Plan, subagent, browser, permission, and diagnostic pushes are sibling variants rather than fake Pi events.
- Prefer explicit unsubscribe functions returned from `subscribe`.
- Abort paths must be implemented for long operations (prompt, fetch, tool runs).

### 3.5 State & side effects

- Pure logic (parse, security classify, format injection) stays pure and unit-tested.
- FS / process / network live in dedicated application services (`media`, `process`, `mcp`, `browser`, `tools-web`); `host-runtime` composes them and `agent-host` remains Pi-only.
- UI components do not call `fs` / `child_process` directly.

### 3.6 Security

- Treat model output and artifact HTML as **untrusted**.
- Artifact: sandbox iframe + CSP; default block external resources (see artifact research).
- Secrets: never log API keys; prefer env/keychain refs in config.
- Permission policy for destructive bash, secret file writes, network tools, force-push — implemented as a layered rule engine with `auto`/`ask-all`/`bypass` modes and a file-write gate (ADR 0019; see [Permissions guide](./docs/guides/permissions.md)). Not an OS sandbox.
- MCP is outside the permission layer entirely: configured servers run with the Host user's OS permissions and never produce prompts or rules (ADR 0033). Legacy MCP rules in `permissions.json` are silently ignored. The user alone owns MCP risk.
- Media paths must stay under `~/.piwin/media/` (no path traversal).

### 3.7 Testing requirements

| Change type | Required tests |
|-------------|----------------|
| Pure function / policy | unit tests |
| contracts type change | update all implementers; typecheck green |
| adapter event mapping | fixture-based unit/integration |
| security classifier | golden cases for allow/block |
| UI only | manual OK early; add e2e later for critical paths |

Do not merge "logic changes" with zero tests when the package already has a test runner.

### 3.8 Git / PR hygiene (private repo still)

- Small commits by concern (docs / contracts / host / feature).
- Do not commit `node_modules`, secrets, `.env`, large media binaries.
- Prefer one feature vertical slice over drive-by refactors in unrelated packages.
- If you must refactor, separate commit from behavior change.

### 3.9 Naming conventions

| Kind | Convention | Example |
|------|------------|---------|
| packages | `@piwin/<kebab>` | `@piwin/agent-host` |
| files | `kebab-case.ts` | `create-host.ts` |
| types/interfaces | `PascalCase` | `SessionHandle` |
| React components (later) | `PascalCase.tsx` | `AgentWindow.tsx` |
| constants | `SCREAMING_SNAKE` or `const` object | `DEFAULT_MAX_ARTIFACT_BYTES` |
| ADR files | `docs/adr/NNNN-title.md` | `0003-dual-mode-host.md` |

### 3.10 What "done" means for a task

1. Types compile (`pnpm typecheck`).
2. Tests pass for touched packages (`pnpm test`).
3. Public exports updated intentionally (no accidental API leaks).
4. Docs/ADR updated if architecture or user-visible behavior changed.
5. No new dependency without justification (prefer stdlib / existing stack).

---

## 4. Feature playbook (how to add anything)

1. **Spec**: does PRD/dev-plan cover it? If architectural, write/update ADR.
2. **Contracts**: add/change types in `@piwin/contracts` if cross-boundary.
3. **Package**: implement in the owning package only.
4. **Host wiring**: compose product services through `@piwin/host-runtime`; use `@piwin/agent-host` only for Pi backends and Pi event/tool adaptation.
5. **App**: CLI and/or Desktop consume public APIs only.
6. **Verify**: typecheck + tests + manual smoke listed in PR/notes.

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

## 5. Explicit anti-patterns (ban list)

- God modules: `helpers.ts`, `misc.ts`, `manager.ts` with mixed domains
- Copy-paste of openwebui Svelte into packages
- UI importing Pi or spawning `pi` directly (must go through host)
- Base64 image data stuffed into **text** prompts (native `ImageContent` parts via Pi `prompt(..., { images })` are the correct path)
- Silent `catch (e) {}`
- Adding Electron "just for now" when Tauri is decided
- Putting product config only in `~/.pi` and skipping `~/.piwin`
- Implementing features only in Desktop and leaving CLI/host inconsistent without documenting intentional CLI degradation
- Drive-by dependency upgrades unrelated to the task

---

## 6. Environment expectations

- Node `>= 20` (repo tested on Node 24+)
- pnpm `9.x` (see `packageManager` in root `package.json`)
- TypeScript project references / workspace packages
- Rust/cargo required later for Tauri desktop (not blocking CLI/host work)

Bootstrap:

```bash
cd ~/Projects/piwin
pnpm install
pnpm typecheck
pnpm test
pnpm dev:cli
```

---

## 7. Agent operating notes (for coding agents)

When implementing in this repo:

1. Read this file + relevant docs before large changes.
2. Prefer minimal diffs that preserve architecture boundaries.
3. Do not create new top-level folders without updating architecture docs.
4. After scaffolding, keep stubs compiling; prefer `throw new Error('not implemented yet')` over fake success.
5. Record architectural decisions in `docs/adr/` when changing dual-mode host, config root, protocols, or artifact/media model.

---

## 8. Terminology & Domain Disambiguation

- **`WalkthroughArtifact` (Walkthrough)**: User-facing, evidence-driven delivery report (`sessionId + messageId` bound). Generated asynchronously by Host via non-streaming provider completion. Displayed as Markdown card under assistant message.
- **`PlanExecutionSummary` (Plan Summary)**: Internal structured data object tracking plan step status (`completedStepIds`, `failedStepIds`, `mergedChildSessionIds`, etc.). Used internally by Host during plan execution orchestration; not a user-facing document.
- **`SessionPlan`**: Structural plan representation in the plan domain (`id`, `title`, `steps`, `status`).

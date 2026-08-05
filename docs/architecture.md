# piwin Architecture

| Field | Value |
|-------|-------|
| Status | Active architecture |
| Date | 2026-08-04 |
| Related | [PRD](./prd.md), [ADRs](./adr/), [Artifact research](./artifact-research.md) |

## 1. Goals

- Clear layers; no UI → Pi internal coupling
- Dual host modes (SDK + RPC) behind one contract from day one
- Packages are independently testable and replaceable
- Desktop (Tauri) and CLI share host + config root `~/.piwin`

## 2. Layered system

```text
┌─────────────────────────────────────────────────────────────┐
│ Presentation                                                 │
│  apps/desktop (Tauri + web UI)   apps/cli (TTY)              │
├─────────────────────────────────────────────────────────────┤
│ Product Host Runtime (composition root)                       │
│  Settings · commands/pushes · Runs · Jobs · scheduling       │
│  permissions · tools · prompt preparation                    │
├─────────────────────────────────────────────────────────────┤
│ Application services (no UI frameworks)                      │
│  session · project · process · skills · mcp · browser        │
│  git · artifact · media · tools-web                          │
├─────────────────────────────────────────────────────────────┤
│ Pi boundary: @piwin/agent-host                               │
│  PiSdkAdapter · Pi worker backend · Pi event/tool adapters   │
├─────────────────────────────────────────────────────────────┤
│ Capability providers                                         │
│  Tools · Skills · MCP · Model protocols · Search/Fetch       │
├─────────────────────────────────────────────────────────────┤
│ Kernel: Pi (pi-ai / pi-agent-core / pi-coding-agent)         │
├─────────────────────────────────────────────────────────────┤
│ Platform: FS · Git · Process · Net · Secure store            │
└─────────────────────────────────────────────────────────────┘
```

### Dependency rule

```text
apps/*  →  packages/host-runtime + public application/UI packages
packages/host-runtime  →  application packages + agent-host + contracts
application packages  →  contracts
packages/agent-host  →  contracts + Pi packages (only place allowed)
packages/agent-host  ↛  application packages
apps/*  ↛  Pi packages
```

Violations are architecture bugs.

## 3. Dual-mode Agent Host

### 3.1 Why both

| Mode | Use | Pros | Cons |
|------|-----|------|------|
| **SDK** (`PiSdkAdapter`) | Default Desktop main / Node CLI | Low latency, full events | Shares process with host |
| **RPC** (`PiRpcAdapter`) | Isolation, external IDE clients, crash boundary | Process isolation | JSONL overhead |

Both adapters remain behind one backend contract. SDK is an in-process Pi
backend. RPC uses a piwin-owned child process supervised by the Product Host,
with one worker keyed by exactly `(sessionId, runtimeGenerationId)`. Desktop
has one Tauri-supervised Product Host; CLI constructs the same composition root
locally. The worker is an execution boundary only: Settings, permissions,
Host tools, Jobs, Runs, and prompt preparation remain parent-owned.

### 3.2 Core contracts (packages/contracts)

```ts
type HostMode = "sdk" | "rpc";

interface AgentHost {
  readonly mode: HostMode;
  createSession(input: CreateSessionInput): Promise<SessionHandle>;
  resumeSession(sessionId: string): Promise<SessionHandle>;
  listSessions(projectId: string): Promise<SessionSummary[]>;
  dispose(): Promise<void>;
}

interface SessionHandle {
  readonly id: string;
  prompt(input: PromptInput): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  getMessages(): Promise<AgentMessageView[]>;
  getTree(): Promise<SessionTreeView>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}

interface PromptInput {
  text: string;
  attachments?: MediaAttachmentRef[];
  streamingBehavior?: "steer" | "followUp";
}
```

`SessionHandle.prompt()` is the backend completion API used inside the Host.
The product `session/prompt` HostCommand follows ADR 0015: it allocates and
returns a `runId` immediately, then observes completion through Host pushes and
RunRegistry state.

### 3.3 Event model

Pi backends normalize Pi SDK and worker events into one `AgentEvent` union:

- `session/*` lifecycle
- `message/*` start/update/end (text, thinking)
- `tool/*` start/update/end
- `compaction/*`
- `error`

Product transport uses a broader `HostPush` union. `agent/event` carries the
normalized Agent stream; Job, Run, Plan, subagent, permission, browser, and
diagnostic pushes are sibling variants. Product services never manufacture
fake Pi-native `AgentEvent` variants for operational state.

### 3.4 Permission system

Host-owned (not UI). Implemented per [ADR 0019](./adr/0019-permission-rule-engine.md)
as a layered rule engine + permission modes + file-write gate + MCP server-level
trust. **This is an approval-layer guard, not an OS sandbox** — it prompts and
blocks, it does not isolate the process (see ADR 0014's "MCP is not a sandbox"
wording for the same honesty applied to MCP).

#### Rule engine (deny → ask → allow)

A single pure function (`permission-rule-engine.ts`) evaluates a
`PermissionSubject` (concrete command / path / host / selector) against a merged
`PermissionRuleSet`. Evaluation order is **deny → ask → allow**, first match
wins within a tier (Claude Code semantics). Specificity does **not** change
order: a broader bundled `ask` beats a more specific user `allow` because tiers
are ordered, not specificity-ranked. No match → the domain default applies (§3.1
of the ADR). The subject (runtime value) and target (pattern) are distinct
types in `@piwin/contracts` so a glob field is never overloaded with a concrete
path/command.

Rule kinds: `bash` (glob, or `re:`-prefixed regex for bundled precision),
`file-write` (`pathGlob` with `~` expansion to `homedir()` at load time),
`web-fetch` (`hostGlob`), `web-search`, `mcp` (`selectorGlob` of the form
`serverId.toolName`), and reserved kinds `git` / `process` / `notes-mutate`
(not yet migrated to the engine — see ADR 0019 §8).

#### Layered rule sources (merge, not override)

Rules merge across layers; **deny at any layer beats allow at any layer** by
tier order:

1. **Bundled defaults** (`permission-defaults.ts`) — safety baseline shipped
   with the product. `deny` and `ask` cannot be allowed away by lower layers.
2. **User global** — `~/.piwin/permissions.json` (full deny/ask/allow).
3. **Project shared** — `<project>/.piwin/permissions.json` (checked in).
4. **Project local** — `<project>/.piwin/permissions.local.json` (gitignored).

Rule files use `version: 1`. Project shared/local **`allow` arrays are dropped
at load time when the project is untrusted** (a repo can only make the agent
*more* cautious, not less); project `deny`/`ask` always apply. User-global
allow always applies (the user's machine, their choice). The merged rule set is
an in-memory construct loaded at **session create**; mid-session edits take
effect on the next session (no hot-reload).

#### Permission modes

`config.permissions.mode` in `~/.piwin/config.json` (`PermissionMode =
'auto' | 'ask-all' | 'bypass'`):

| Mode | bash unmatched | file-write in-project | file-write out-of-project | public network | MCP | deny rules |
|------|----------------|----------------------|--------------------------|----------------|-----|------------|
| `ask-all` | ask | ask | ask | ask | server-gated (§MCP) | always enforced |
| `auto` | allow¹ | allow | ask | ask | server-gated | always enforced |
| `bypass` | allow | allow | allow | allow | server-gated | **still enforced** |

¹ `auto` bash unmatched → allow **only after** bundled deny **and** bundled ask
tiers. A built-in safe-prefix allowlist (`ls *`, `git status`, `pnpm test`, …)
is bundled as `allow` rules so they are visible/editable (useful mainly under
`ask-all`).

**Bypass guard:** `bypass` is refused for **untrusted** projects (downgraded to
`auto` + `host/log` warning) so a freshly-cloned repo cannot disable prompts by
editing its own `permissions.json`. **General scope** (no project) may use
bypass — the user is the trust authority there. Deny rules are the only guard in
bypass (matches Claude Code's `bypassPermissions` semantics). Non-interactive
CLI: `ask` resolves to `deny` (`resolveNonInteractiveDecision`).

#### File-write gate

`gated-file-tools.ts` wraps Pi's `write`/`edit` tools (same shape as
`gated-bash-tool.ts`): resolves the path (`realpath` when the file exists,
pre-realpath absolute path for new files), checks the project remembered
allowlist, evaluates `evaluateFileWritePermission` against the merged rules,
then prompts on `ask` via the interactive gate. Both `writeFile` and `mkdir`
are gated (recursive mkdir can create trees outside the project before a
write). Bundled deny covers secret paths (`~/.ssh/**`, `~/.piwin/**`,
`**/.env`, `**/*.pem`, `**/id_rsa`, …); `~/.config/**` is bundled **ask**
(sensitive but sometimes legitimate). The legacy `path-guard` Pi extension
remains as a defense-in-depth second layer; the primary gate is the host rule
engine so it is configurable, testable, and rememberable.

#### MCP: server-level trust (supersedes ADR 0014 §5)

**Once an MCP server is enabled in config, its tools run without per-call
permission prompts.** Server enablement is the deliberate trust boundary (the
moment of trust is adding the server in `~/.piwin/mcp.json` / Settings, not each
tool call). `assertMcpToolCallAllowed` consults the rule engine for explicit
`deny`/`ask` MCP rules; on `allow` or `no-match` it allows. Risk classification
(`evaluateMcpToolCallRisk`) and argument redaction still run for UI display but
no longer drive an `ask` decision. Users who want per-tool gating add
`deny`/`ask` MCP rules in `permissions.json`.

#### Project remember (scope extended)

`permission/resolve` with `rememberScope: 'project'` persists for:

- **bash** — `ProjectRecord.bashAllowlist`: the **full command string**, matched
  by **exact match only** (after trim). Naive prefix is forbidden (approving
  `rm -rf /tmp/foo` must not auto-allow `rm -rf /tmp/foo /etc`).
- **file-write** — `ProjectRecord.fileWriteAllowlist`: resolved absolute path,
  matched by **path-safe prefix** (`path === stored || path.startsWith(stored + sep)`).
- **network** — unchanged (`allowedFetchHosts`, `allowWebSearch` — exact host).

MCP needs no remember (server-gated). Revocation (`project/permissions-revoke`)
extends to the new keys; `listRememberedPermissions` surfaces them in Settings.

#### Dual host modes

File-write gate, bash gate, rule loading, and the bypass guard apply on every
Host tool execution path. `@piwin/host-runtime` owns those gates and injects a
runtime-generation-scoped tool router into either backend. SDK calls it
directly; the isolated worker proxies calls back to the parent. Apps never
import Pi, and `@piwin/agent-host` never owns product permission policy.

#### Desktop UI (first-tier)

Settings → Permissions page: mode switcher bound to the user-facing
`config.permissions?.preset ?? 'yolo'` with trust-aware notices. New sessions
default to Pi-compatible YOLO: ordinary actions run without approval prompts;
deny rules, circuit breakers, and the untrusted-project guard remain active.
Context bar shows a **mode badge** (click → open Permissions; `bypass` rendered
with a warning tone). Permission prompt dialog offers **"Allow for project"**
for bash/file-write subjects (persisted via the remember keys above). A full
visual rule editor is a follow-up (ADR 0019 open questions); until then users
edit `permissions.json` by hand.

### 3.5 Extension UI bridge (model questionnaire)

The model-facing `questionnaire` tool is a **bundled Pi Extension** (ADR 0010
ResourceLoader path; ADR 0023). It calls only Pi-native `ctx.ui.select` /
`ctx.ui.input`, so piwin adds **no new IPC or question contract**:

- **Desktop** renders the request as an inline `extension-ui-prompt` attached to
  the Composer. It handles `extension/ui_request` → `extension/ui_resolve` for
  `confirm` / `select` / `input` without a modal: choices sit above the input
  box, and the `input` phase (including questionnaire `Other`) reuses the main
  Composer textarea so the user can type and submit in place. Stop remains
  available in the same surface and uses the existing abort control path.
- **CLI** wires `createCliExtensionUiRequestHandler` into the existing
  `onExtensionUiRequest` seam on `createAgentHost`. It renders numbered
  prompts to `process.stderr` via `readline/promises`; **stdout remains the
  clean model/output protocol**. Non-TTY sessions resolve as cancelled /
  unavailable rather than blocking.
- **Boundary:** `apps/cli` and `apps/desktop` consume only
  `@piwin/agent-host` public exports (`ExtensionUiRequest` /
  `ExtensionUiResponse`, the handler factory). No `@earendil-works/pi-*` import
  crosses the app boundary (AGENTS.md §1). SDK and RPC→SDK-fallback share one
  interaction path; the surfaces differ only in renderer.

### 3.6 Runtime control and execution planes

Runtime control follows [`runtime-refactor.md`](./specs/runtime-refactor.md):

| Domain | Meaning | Authority |
|---|---|---|
| Runtime generation | One live Pi backend instance for a product session | `SessionRuntimeController` |
| Run | Agent/orchestration work and structured cancellation | `RunRegistry` |
| Job | User-visible non-interactive OS child process | `JobController` |
| Worker | Internal isolated Pi process for one runtime generation | `AgentWorkerSupervisor` |
| Terminal | Interactive desktop PTY | Tauri |

Runs and Jobs are linked but are not a polymorphic state object. A parent Run
cannot become terminal while a descendant remains non-terminal. Run
cancellation closes child admission, aborts descendants, cleans run-lifetime
Jobs, and joins children before the parent terminal transition.

Parallel subagent scheduling is work-conserving and uses one orchestrator.
Configured concurrency greater than one is effective only when the backend
reports real process isolation. Write tasks use per-child worktrees and
repository-keyed serialized integration.

Runtime reload is a Host-owned replacement transaction. A candidate Blueprint
is compiled first, the current generation and all Run descendants are joined,
the old worker generation is disposed, and the replacement is published only
after the new backend is active. Failed candidates never replace the active
generation. Dirty-base parallel writes default to an explicit one-run `ask`
decision; worktrees are retained on integration conflicts and no automatic
retry or conflict resolution is performed.

## 4. Package map

| Package | Responsibility |
|---------|----------------|
| `@piwin/contracts` | Types, events, config schemas (runtime-light) |
| `@piwin/host-runtime` | Product composition root: Settings compilation, command/push routing, runtime generations, Runs, Jobs, permissions, tools, prompt preparation |
| `@piwin/agent-host` | Pi-only boundary: SDK backend, isolated worker backend, Pi event/tool adapters, worker protocol |
| `@piwin/session` | History index, tree projection, naming |
| `@piwin/project` | Workspace/project trust, cwd binding |
| `@piwin/skills` | Discovery, install, defaults, find/create helpers |
| `@piwin/mcp` | Config document, client lifecycle, tools bridge |
| `@piwin/tools-web` | `web_search`, `web_fetch` providers |
| `@piwin/git` | Status, diff, commit graph model |
| `@piwin/theme` | Theme packages install/apply |
| `@piwin/pet` | Codex pet adapter + state machine |
| `@piwin/artifact` | Markdown helpers + HTML artifact runtime (from openwebui_m) |
| `@piwin/browser` | Playwright-driven browser session (agent tools + panel mirror + element pick) |
| `@piwin/process` | Non-interactive Job registry, process-tree supervision, logs, readiness |
| `@piwin/media` | Paste store and previews; PromptPreparation validates model-facing media refs |
| `@piwin/marketplace` | Unified install sources |
| `@piwin/ui-kit` | Shared desktop UI primitives |

## 5. Config root `~/.piwin`

```text
~/.piwin/
  config.json                 # product config (host mode, providers, imageGeneration, Desktop composer/session restore)
  credentials/                # secrets (prefer OS keychain)
  sessions-index/             # SQLite or JSONL index over Pi sessions
  skills/
  mcp.json
  themes/
  pets/
  media/<session-id>/
  jobs/                       # Job metadata and diagnostic log spool
  logs/
```

Pi native paths remain under `~/.pi/agent/`. piwin maps:

- sessions: prefer Pi session files; maintain index for UI
- skills: bundled + `~/.piwin/skills` + optional maps to other harness skill dirs. System skills (e.g. `imagegen`) use frontmatter `hidden: true` to stay out of the Skills panel/CLI while remaining loadable by Pi; the `imagegen` skill is toggled via `config.skills.disabledIds` (enables/disables both the skill and the `image_gen` host tool).
- extensions: optional Pi extensions under `extensions/` shipped with piwin

`config.json` may retain the Desktop's per-next-turn composer profile (model
and thinking effort) and last selected session. These are product settings,
not browser-local presentation preferences. Restoring a project session opens
the project without granting new trust; sending remains gated by its current
trust state. The `imageGeneration` config section holds the default image model,
configured through the Desktop's `Image Generation` settings page.

## 6. Model protocols

User-configured entries, not hardcoded vendors:

1. `openai-compatible` — baseUrl, apiKey env/ref, models
2. `anthropic-compatible` — baseUrl, apiKey env/ref, models

Host translates config into Pi model/provider registration.

## 7. Rendering pipeline

```text
Assistant message
  → Markdown renderer (default)
  → Fence detector
      → plain code block
      → HTML artifact candidate → artifact runtime (security → srcdoc → iframe)
  → Image attachments → media preview components
```

User composer:

```text
Paste image
  → media service save ~/.piwin/media/<session>/<uuid>.ext
  → composer attachment chip + thumbnail
  → on send: PromptInput.attachments[]
  → PromptPreparation validates path/MIME/size and selects routing
  → vision path: native ImageContent passed to Pi, without path text
  → text-only path: vision delegation; explicit path fallback only when needed
```

## 8. Browser Session

A host-owned, Playwright-driven browser session (`@piwin/browser`, ADR 0020) that
owns **one** headless Chromium shared by the agent and the desktop panel — "what
the user sees == what the agent controls".

- **Agent tools** — `browser_navigate` / `browser_snapshot` / `browser_click` /
  `browser_type` / `browser_fill_form` / `browser_scroll` / `browser_screenshot` /
  `browser_find` / `browser_back` / `browser_forward` / `browser_wait`, registered
  by `@piwin/agent-host` (`browser-tools.ts`). Snapshots use the **same ref
  grammar as `@playwright/mcp`**: `locator('html').ariaSnapshot({ mode: 'ai',
  boxes: true })` emits `[ref=eN]` + `[box=x,y,w,h]` annotations, and refs resolve
  via `locator('aria-ref=e5')`. The snapshot output is **not** parseable YAML
  (plain scalars with inline annotations; the `yaml` parser folds the indented
  children), so `@piwin/browser` derives the tree with a small dedicated line
  parser — no `yaml` dependency and no `page.accessibility` (removed in
  Playwright 1.x).
- **Panel mirror** — the desktop `BrowserSessionPanel` renders throttled JPEG
  frame pushes (`browser/frame`, ~2–4 fps, size-capped) plus URL/title state
  (`browser/state`) from the **same** instance the agent drives.
- **Element pick → attach** — a user-initiated pick runs `elementFromPoint` in
  the page context (same-origin, works on any site), returns a stable CSS
  selector (`@medv/finder`, bundled and injected at the context level so it
  survives navigation) + a bounded `innerText`/`outerHTML` + best-effort
  snapshot `ref` + optional element-cropped screenshot under the media root. On
  send, the host injects model-facing text (**URL + selector + bounded text +
  optional screenshot path — no base64**, AGENTS.md §3.6) via
  `formatTextModelWebElementInjection`.
- **Permission** — `browser_navigate` allows **loopback only** (`localhost`,
  `127.0.0.1`, `::1`) by default; **link-local / cloud metadata
  (`169.254.169.254`, `fe80::/10`) and private ranges (`10/8`, `172.16/12`,
  `192.168/16`, `fd00::/8`) go through the rule engine with default `ask`** —
  never blanket-allow private (SSRF). Classification reuses
  `isPrivateOrLocalHostname` / `isPrivateOrLocalIpAddress` from `@piwin/tools-web`.
  Pick/attach is user-initiated (no prompt).
- **CLI parity** — `browser_*` tools work in CLI sessions (host-owned service);
  the visual panel is desktop-only. The degradation is intentional and documented
  (AGENTS.md §5).
- **Chromium** — `playwright-core` does not download browsers; it reuses the
  chromium installed by `pnpm --dir apps/desktop e2e:install` (`playwright
  install chromium`). `piwin doctor` reports chromium presence with an actionable
  install hint.

## 9. Tauri desktop shape

```text
apps/desktop/
  src/                 # React (or chosen web UI)
  src-tauri/           # Rust shell: windowing, FS bridges, OS integrations
```

Tauri main process / commands call into Node host **or** a long-lived host sidecar.

**v1 recommendation**: Node host sidecar process owned by Tauri; UI talks over local IPC (JSON events). Same host binary used by CLI.

Alternative (simpler smoke): CLI embeds host in-process; Desktop spawns `piwin host --mode sdk|rpc`.

## 10. CLI shape

```text
apps/cli → @piwin/host-runtime
```

Commands mirror host capabilities; no separate business logic.

## 11. Testing strategy

| Layer | Tests |
|-------|-------|
| contracts | type-level / schema validation |
| artifact/media/git pure logic | vitest unit tests |
| host-runtime | Run/Job ownership, command/push routing, cancellation integration |
| agent-host backends | parameterized SDK/worker conformance + Pi event fixtures |
| desktop critical flows | playwright later |

## 12. Evolution rules (anti-shitpile)

1. New feature → ADR if it crosses packages
2. Contracts first, then package, then app wiring
3. No cross-import of app code from packages
4. Marketplace installs only through `@piwin/marketplace`
5. Prefer deleting code over "temporary" helpers that become permanent

## 13. Open implementation choices (tracked)

| Topic | Current lean |
|-------|----------------|
| Desktop UI kit | React + Vite inside Tauri |
| Session index DB | SQLite |
| Default host mode | SDK |
| Sidecar vs in-process for Tauri | Sidecar host process |

## 14. Capability honesty (2026-07-24)

| Layer | States (truthful labels) | Notes |
|-------|--------------------------|-------|
| **Desktop transport** | Browser mock · Tauri sidecar | Browser Playwright uses mock host. Tauri uses a **two-tier** spawn (ADR 0017): packaged Node sidecar + `host/host-serve.mjs` when present, else workspace `pnpm`/`tsx` (dev). Packaged path still requires **S5 clean-machine smoke** before claiming public distribution readiness. Wire-protocol rules: [`ipc-transport-discipline.md`](./ipc-transport-discipline.md). |
| **Agent backend** | mock session · SDK in-process · RPC worker isolated | UI never claims a live model when mock is active. Until Runtime Refactor Phase 3 exits, any fallback is labeled transitional and not isolated. |
| **Desktop host mode** | SDK in-process · RPC worker isolated when available | Desktop must report actual backend and isolation capability; it must not infer isolation from configured `hostMode` alone. |
| **Terminal** | Tauri PTY authorized · unavailable | Interactive Terminal is a **desktop capability** (ADR 0013). Host `capabilities.pty` is **not** proof that Tauri Terminal is unavailable or available. |
| **Jobs** | starting · running · ready · terminal | Non-interactive process state comes from JobController; interactive Terminal remains Tauri-owned. |
| **Provider** | unconfigured · credential unavailable · configured | Best-effort status only. Provider readiness must **not** gate workspace browse/trust (PSR D7). |
| **Packages** | `memory`, `process`, `automation` first-class | Product commands route through host-runtime; Advanced/Experimental in Desktop Settings. |
| **Evidence coverage** | browser mock · live JSONL sidecar · native macOS | [See automated prerequisites](../README.md#automated-prerequisite-sequence) and [trace recipe](plans/2026-07-24-responsiveness-trace-recipe.md). Automated prerequisites are not a release candidate; a separately reviewed dated native macOS evidence manifest is required before declaring one. |

### Evidence layers

| Layer | What it proves | Cannot claim |
|-------|----------------|--------------|
| **Vite + in-browser mock renderer** | UI rendering isolation, render counts, frame-batching, Stop path under mock | Native responsiveness, real transport latency, main-thread behavior |
| **Live JSONL sidecar** | Sidecar stdio framing, control-lane priority, abort/status ordering, clean shutdown, malformed-input handling | WebView rendering, macOS window behavior |
| **Native macOS / Tauri** | Real window drag/resize during streaming, Instruments traces, PID cleanup, bundle/notarization | Cross-platform parity, bundled Node distribution |

Always surface these layers via status UI + `host/status` + doctor matrix; never silent-degrade or conflate transport connection with provider readiness.

### Intentionally deferred (not in release gate)

The following remain explicitly outside the responsiveness evidence gate and
must not be claimed:

1. **Packaged host distribution:** current Tauri development topology starts a
   workspace `pnpm`/`tsx` host from the source checkout. A clean installed app
   requires a bundled executable or Node runtime, resource resolution,
   signing/notarization, and clean-machine verification — planned in
   [ADR 0017](./adr/0017-host-sidecar-bundling.md).
2. **Runtime Refactor Phases 1-3:** Job control, structured concurrency, and
   true RPC worker isolation are implemented and guarded by
   [`runtime-refactor.md`](./specs/runtime-refactor.md), ADR 0030, and the
   architecture check. The remaining deferred item is packaged desktop
   distribution, not runtime authority.
3. **Follow-up turn lifecycle:** `session/follow_up` now validates run
   ownership, but a distinct foreground lifecycle is not introduced here.
   Decide in a separate ADR/plan whether it appends to an existing run or
  starts a new run with its own `runId` and terminal event.

## Side Chat (ADR 0032)

Side Chat is a persistent, read-only, Host-backed chat session that inherits
bounded context from a main session. It is a distinct product session kind
(`sessionKind: 'side-chat'`) with its own `SideChatRelation` — it does **not**
use `parentSessionId` and does **not** enter subagent lineage/merge/worktree
flows.

Key invariants:

- **Read-only tool profile**: Host compiles a fixed capability profile
  (`filesystem-read` + `read/grep/find/ls` pi builtins + optional
  `web-search`/`web-fetch`). Write/shell/process/browser/mcp/planning/delegate
  tools are explicitly absent. UI hiding is not the security boundary.
- **Context snapshot, not live mirror**: Side Chat captures a bounded context
  snapshot at creation time (24k chars / 40 messages). Subsequent updates
  require explicit `side-chat/sync`, which bumps `contextVersion`.
- **Run isolation**: Main and side runs are independent (keyed by sessionId).
  `session/prompt` and `session/abort` work identically for side-chat sessions.
- **Main list invisibility**: Side chats are excluded from `session/list` and
  `session/search` by default (SIDE-D9).
- **Source state tracking**: Archiving the main session marks side chats'
  `sourceState: 'archived'`; deleting marks `'missing'`. Sync is disabled
  when source is not active.

See [ADR 0032](./adr/0032-side-chat-context-branch.md) and
[spec](./specs/side-chat-session.md) for full details.

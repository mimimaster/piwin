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
- The Host is independently deployable; multiple shells can connect to one
  authoritative Host instance

## 2. Layered system

```text
┌─────────────────────────────────────────────────────────────┐
│ Presentation / client shells                                  │
│  apps/desktop · apps/cli · apps/mobile · future Web client    │
├─────────────────────────────────────────────────────────────┤
│ Host Server / transport boundary                             │
│  local sidecar · private WebSocket · auth · replay · health   │
├─────────────────────────────────────────────────────────────┤
│ Product Host Runtime (composition root)                       │
│  Settings · commands/pushes · Runs · Jobs · scheduling       │
│  permissions · tools · prompt preparation                    │
├─────────────────────────────────────────────────────────────┤
│ Application services (no UI frameworks)                      │
│  session · project · process · skills · mcp · browser        │
│  git · artifact · media · tools-web · notes · flashcards     │
│  knowledge (Host registry over notes + folder RAG)           │
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
apps/desktop, apps/cli, apps/mobile, future client apps
         → public host-client/transport packages + contracts
apps/host → host-server → host-runtime
packages/host-runtime  →  application packages + agent-host + contracts
application packages  →  contracts
packages/agent-host  →  contracts + Pi packages (only place allowed)
packages/agent-host  ↛  application packages
# `@piwin/voice` is an application package (Pi-free). Host-runtime composes it;
# agent-host never imports voice; voice never imports agent-host/session.
apps/*  ↛  Pi packages
apps/gateway (optional) → host-transport + contracts only
```

Violations are architecture bugs.

### 2.0.1 piwin Live topology (ADR 0065)

Realtime voice is Host-owned control with Desktop-owned media. First-period
channels: **openai-codex** (subscription OAuth) and **google-gemini** (Host
API key → constrained ephemeral token). Spec:
[2026-08-29-live-provider-adapter.md](./specs/2026-08-29-live-provider-adapter.md).

```text
Desktop Live Controller + Media Driver Registry (mediaDriverId)
  → HostCommand voice/live/* (owner-only start bootstrap)
  → host-runtime LiveCallCoordinator
      → Host Provider Registry (providerId)
      → @piwin/voice adapter (auth + start material only)
      → Desktop-normalized delegation → Host admission
      → existing Session/Run/Permission (queue when busy)
```

Host does not PCM-relay audio. Sanitized call status may fan out. Long-lived
credentials never leave Host. One-shot owner bootstrap (SDP answer or Gemini
ephemeral token) appears only on the owner start response — never in
HostPush journals, status, or persisted errors.

### 2.0.2 Flashcard study workbench (ADR 0066)

Study progress is Host-owned. Desktop, Mobile, and CLI share one CardStore,
one `flashcards/study/*` protocol, and one FSRS `ReviewState` write path.
Shells do not keep a second library or a phone-local scheduler.

```text
Desktop study page · Mobile catalog/study · CLI `piwin study`
  → HostCommand flashcards/study/*  (idempotencyKey on the existing envelope)
  → host-runtime study commands
      → @piwin/flashcards StudyService (rounds + operation log + ReviewState)
      → Push flashcards/study/changed {roundId, revision, reason}
```

Cards stay in `~/.piwin/flashcards/cards/`; ReviewState in `review/`. New user
data (lazy-created): `study/rounds/<roundId>.json`,
`study/operations/<sequence>-<keyHash>.json`. `ReviewState.revision` is
additive (missing = 0). Card UI and `fcws-tear-off` 200ms stay; ui-kit
`FlashcardFace` / `TearDeckSurface` are the shared faces.

Intentional v1 differences, not unfinished ports:

- Mobile source preview is title + excerpt only; Host absolute paths are
  stripped; never `doccards/open-source`.
- Online-only: no Host → no new round, no batch rate, no offline library.
- CLI has **no tear animation** and no touch; checkpoint before `rate`.

ADR 0066 is **Implemented in tree — verification incomplete**. Dual-device
V04/V09/V22, visual fixtures, and root typecheck/mobile build are **not**
passed. Do not document this as Accepted / 已上线.

### 2.1 Host-first deployment model

`@piwin/host-runtime` is the execution authority. `@piwin/host-server` wraps it
with the first loopback/private WebSocket transport, token authentication,
client admission, replay, health, and lifecycle management. The same server may
run as a local Tauri sidecar or as a standalone process on a Mac,
Windows/Linux machine, NAS, or server.

```text
Local:
  Desktop/CLI shell → local Host Server → HostRuntime → agent-host → Pi

Remote:
  Desktop/Windows/Mobile/CLI shell
      → private network or optional Gateway/tunnel
      → Host Server → HostRuntime → agent-host → Pi
```

One Host process owns one configured `~/.piwin` data root. Multiple clients
observe and control that Host through `HostCommand` / `HostPush`; they do not
create independent Agent loops or synchronize independent session databases.
The canonical target and implementation phases are recorded in
[`specs/host-server-multi-client.md`](./specs/host-server-multi-client.md) and
ADR 0036. Concurrent edits from several shells on one Host follow
[`specs/multi-client-concurrency.md`](./specs/multi-client-concurrency.md).


## 2.2 Session runtime residency (ADR 0040)

Durable chat records and live Agent runtimes are separate authorities.

- Opening history is a bounded product-transcript read (`live: false`); it does
  not allocate a Pi session, Host handle, recorder, or worker.
- The first prompt (or an explicit reload) activates a stable product session id
  with a new `runtimeGenerationId`. Host tools admit against the stable session
  Run; Agent event ids are generation-scoped.
- Idle runtimes are Host-evicted by TTL, max-idle LRU, max-resident, and optional
  RSS high-water pressure. Busy Runs, pending permissions/UI, compaction, and
  replacement transactions are never eviction candidates.
- Clients (Desktop/CLI) observe `session/runtime-status.residency` and
  `host/runtime-resources`; they never own timers, LRU, or memory thresholds.
- Long-session transcript retention is bounded by the SQLite session transcript
  store (WP6), with legacy JSON fallback and doctor-detectable migration.
- The store is a conversation tree (ADR 0055): each row has
  `parent_message_id`, and `active_leaf_message_id` selects the visible path.
  Edit/regenerate appends a sibling; `session/truncate-from` deletes a
  subtree. Clients never hold parent ids. Switching warns when the abandoned
  path wrote files; disk does not follow the leaf.

## 2.3 Session storage residency (ADR 0044)

Archive lifecycle, runtime residency, and payload storage are separate
authorities. Runtime cold (ADR 0040) still has a local transcript. Storage
`offloaded` means transcript + media live in a verified Host-external pack;
the index keeps a discoverable stub.

- One pack per session; destructive offload always includes full media.
- Non-payload files (`plan.json`, walkthroughs) stay under `sessions/<id>/`.
- `packOutputDir` is always a Host filesystem path, never a client-local path.
- Offload is manual plan + confirm. Plans are in-memory only. Host startup
  recovers journaled transactions under `~/.piwin/cold-storage/transactions/`.
- Opening an offloaded or missing-pack session never creates an empty
  `transcript.sqlite3`. Desktop is restore-first.
- Operator recovery: [`guides/session-cold-storage.md`](./guides/session-cold-storage.md).


## 3. Dual-mode Agent Host

### 3.1 Why both

| Mode | Use | Pros | Cons |
|------|-----|------|------|
| **SDK** (`PiSdkAdapter`) | Default Desktop main / Node CLI | Low latency, full events | Shares process with host |
| **RPC** (`PiRpcAdapter`) | Isolation, external IDE clients, crash boundary | Process isolation | JSONL overhead |

Both adapters remain behind one backend contract. SDK is an in-process Pi
backend. RPC uses a piwin-owned child process supervised by the Product Host,
with one worker keyed by exactly `(sessionId, runtimeGenerationId)`. A local
Desktop may supervise the Host as a sidecar; a standalone Host Server may run
the same composition root on another machine. The worker is an execution
boundary only: Settings, permissions, Host tools, Jobs, Runs, and prompt
preparation remain Host-owned.

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
  prompt(input: PromptInput): Promise<AgentPromptOutcome>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  armRunIntervention?(input: BackendRunIntervention): Promise<void>;
  cancelRunIntervention?(interventionId: string, expectedRevision: number): Promise<boolean>;
  subscribeRunInterventions?(listener: RunInterventionListener): () => void;
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
It returns one structured `AgentPromptOutcome` (`completed` | `failed` |
`aborted`) after Pi settles. The product `session/prompt` HostCommand still
follows ADR 0015: it allocates and returns a `runId` immediately. Host
`session-turn-executor` then terminalizes that Run once from the outcome.
Desktop and CLI are projections; an `AgentEvent.error` is evidence only.

Call chain for a foreground turn:

```text
Pi Agent Loop
  → @piwin/agent-host (outcome + explicit runId on Agent events)
  → Host session-turn-executor / RunRegistry
  → Host push publisher (the only AgentEventEnvelope producer)
```

`steer()` and `followUp()` remain compatibility backend methods, not the
product control vocabulary. New clients use the Host-owned Run intervention
commands from [ADR 0051](./adr/0051-host-owned-run-interventions.md): the Host
durably accepts an instruction for one exact `(runId, runtimeGenerationId)`,
then `agent-host` applies it at Pi's next safe checkpoint through a lifecycle
channel separate from `AgentEvent`. Pending or failed instructions remain
visible in the product transcript but enter reconstructed model history only
after their state is `applied`. SDK and RPC-worker modes implement the same
arm/claim/apply protocol.

### 3.3 Event model

Pi backends normalize Pi SDK and worker events into one `AgentEvent` union:

- `session/*` lifecycle
- `message/*` start/update/end (text, thinking)
- `tool/*` start/update/end
- `compaction/*`
- `model/retry`
- `error`

Product transport uses a broader `HostPush` union. `agent/event` carries the
normalized Agent stream; Job, Run, Plan, subagent, permission, browser, and
diagnostic pushes are sibling variants. Product services never manufacture
fake Pi-native `AgentEvent` variants for operational state.

### 3.4 Permission system

Host-owned (not UI). Implemented per [ADR 0019](./adr/0019-permission-rule-engine.md)
as a layered rule engine + permission modes + file-write gate. **This is an
approval-layer guard, not an OS sandbox** — it prompts and blocks, it does not
isolate the process.

#### Rule engine (deny → ask → allow)

A single pure function (`permission-rule-engine.ts`) evaluates a
`PermissionSubject` (concrete command / path / host) against a merged
`PermissionRuleSet`. Evaluation order is **deny → ask → allow**, first match
wins within a tier (Claude Code semantics). Specificity does **not** change
order: a broader bundled `ask` beats a more specific user `allow` because tiers
are ordered, not specificity-ranked. No match → the domain default applies (§3.1
of the ADR). The subject (runtime value) and target (pattern) are distinct
types in `@piwin/contracts` so a glob field is never overloaded with a concrete
path/command.

Rule kinds: `bash` (glob, or `re:`-prefixed regex for bundled precision),
`file-write` (`pathGlob` with `~` expansion to `homedir()` at load time),
`web-fetch` (`hostGlob`), `web-search`, and reserved kinds `git` / `process` /
`notes-mutate` (not yet migrated to the engine — see ADR 0019 §8). MCP is not a
rule kind.

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

| Mode | bash unmatched | file-write in-project | file-write out-of-project | public network | deny rules |
|------|----------------|----------------------|--------------------------|----------------|------------|
| `ask-all` | ask | ask | ask | ask | always enforced |
| `auto` | allow¹ | allow | ask | ask | always enforced |
| `bypass` | allow¹ | allow | allow | allow | **still enforced** |

¹ Bash unmatched → allow **only after** bundled deny **and** bundled ask
tiers. YOLO still **asks** for `rm -rf` (`rm-recursive-force`) and still
**denies** circuit breakers. Leave-workspace writers (`tee /tmp`, out-of-project
`write`) ask in `auto` / `ask-all` only. A built-in safe-prefix allowlist
(`ls *`, `git status`, `pnpm test`, …) is bundled as `allow` rules so they
are visible/editable (useful mainly under `ask-all`).

**Bypass guard:** `bypass` is refused for **untrusted** projects (downgraded to
`auto` + `host/log` warning) so a freshly-cloned repo cannot disable prompts by
editing its own `permissions.json`. **General scope** (no project) may use
bypass — the user is the trust authority there. Deny rules and leave-workspace
asks still apply in bypass. Non-interactive CLI: `ask` resolves to `deny`
(`resolveNonInteractiveDecision`).

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

#### MCP execution boundary (ADR 0033)

MCP is deliberately outside the permission rule engine. Adding or enabling a
server in `~/.piwin/mcp.json` is the user's trust decision; configured MCP
tools never produce per-call permission prompts and never consult
`PermissionRuleSet`, `PermissionMode`, or `PermissionSubject`. MCP servers run
with the Host user's OS permissions and are not sandboxed by this layer.

`@piwin/host-runtime` creates one `McpSupervisor` per Host, implemented by
`@piwin/mcp`. It owns each MCP process from spawn through readiness, config
replacement, timeout, crash, and shutdown. The gateway and any explicitly
pinned direct tools call the same Supervisor; sessions and UI never own MCP
clients. The default model surface is gateway-only (`search`, `describe`,
`call`, `status`); direct tools require explicit `pinnedSelectors`.

`pinnedSelectors` lives at the top level of `~/.piwin/mcp.json` and contains
exact `serverId.toolName` selectors. The MCP tool catalog persists outline/filled
pin state through `mcp/save`; pinning keeps a tool in the model surface but does
not make its process resident or trigger a spawn. Pin-only changes update the
exposure revision without draining a server and take effect on the next session
or an explicit tool-surface rebuild.

Legacy `mcp` rules left in `permissions.json` are silently ignored (optionally
one diagnostic log entry); they are not migrated, upgraded, or used to block
or prompt. `mcp.json` remains fully active. See [ADR 0033](./adr/0033-mcp-supervisor-architecture.md)
for lifecycle and config-reload invariants.

#### Lazy Host toolbox (ADR 0044 / ADR 0053)

High-frequency filesystem, shell, web, browser, planning, delegation, Artifact
instruction tools, and pinned MCP tools stay directly visible. Low-frequency
process, notes, flashcards, image, and video schemas, plus unpinned
MCP tools, are discovered through `piwin_toolbox search` and invoked through
`piwin_toolbox call`. The session execution port dispatches a Host call through
the target's original registration and permission gate; MCP calls stay trusted
on the Supervisor. The routing shell cannot widen the compiled generation
allowlist or bypass target admission. Conversation sessions keep MCP closed.
See [ADR 0044](./adr/0044-lazy-host-toolbox.md) and
[ADR 0053](./adr/0053-progressive-tool-catalog.md).

#### Project remember (scope extended)

`permission/resolve` with `rememberScope: 'project'` persists for:

- **bash** — `ProjectRecord.bashAllowlist`: the **full command string**, matched
  by **exact match only** (after trim). Naive prefix is forbidden (approving
  `rm -rf /tmp/foo` must not auto-allow `rm -rf /tmp/foo /etc`).
- **file-write** — `ProjectRecord.fileWriteAllowlist`: resolved absolute path,
  matched by **path-safe prefix** (`path === stored || path.startsWith(stored + sep)`).
- **network** — unchanged (`allowedFetchHosts`, `allowWebSearch` — exact host).

MCP has no permission remember/revoke entry because it is outside this rule
engine. Revocation (`project/permissions-revoke`) applies to the bash and
file-write keys above; `listRememberedPermissions` surfaces those in Settings.

#### Dual host modes

File-write gate, bash gate, rule loading, and the bypass guard apply on every
Host tool execution path. `@piwin/host-runtime` owns those gates and injects a
runtime-generation `SessionHostToolExecutionPort` plus one
`HostToolExecutionRouter` per generation surface. Policy evaluation is a
pure function; approval memory and prompts live in a separate broker; identical
`toolCallId` frames are coalesced by a generation-scoped ledger. SDK calls the
port directly; the isolated worker proxies calls back to the parent. Apps never
import Pi, and `@piwin/agent-host` never owns product permission policy.

#### Desktop UI (first-tier)

Settings → Permissions page: mode switcher bound to the user-facing
`config.permissions?.preset ?? 'yolo'` with trust-aware notices. New sessions
default to Pi-compatible YOLO: ordinary in-project actions run without approval
prompts; leaving the workspace, deny rules, circuit breakers, and the
untrusted-project guard remain active.
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

The product surface is Agent tools, event hooks, and those four dialogs. Pi
TUI chrome (custom components, widgets, themes, keybindings, editor, custom
rendering) and native `/reload` are not bridged — they no-op or error.
[`docs/guides/pi-extensions.md`](guides/pi-extensions.md), `piwin extension list`,
and `piwin doctor` state that boundary.

### 3.6 Runtime control and execution planes

Runtime control follows [`runtime-refactor.md`](./specs/runtime-refactor.md):

| Domain | Meaning | Authority |
|---|---|---|
| Session | Durable conversation identity | SessionIndex |
| Run | Agent/orchestration work and structured cancellation | `RunRegistry` |
| Execution lease | Permission for one leaf model/tool turn | `RuntimeResourceCoordinator` |
| Runtime generation | One live Pi backend instance for a product session | `SessionRuntimeController` |
| Job | User-visible non-interactive OS child process | `JobController` |
| Worker | Internal isolated Pi process for one runtime generation. Pool size derives from `subagents.maxConcurrency` (supervisor cap adds +1 replacement headroom). | `AgentWorkerSupervisor` |
| Terminal | Interactive desktop PTY | Tauri |

Session count is unbounded. Local Host leaf execution defaults to 8 concurrent
runs; further prompts are accepted with a real `runId` then queued. Worker
count and `subagents.maxConcurrency` do not cap Sessions or foreground Runs.
`session/create` writes the durable record only and never waits on Runtime or
Worker capacity.

Runs and Jobs are linked but are not a polymorphic state object. A parent Run
cannot become terminal while a descendant remains non-terminal. Run
cancellation closes child admission, aborts descendants, cleans run-lifetime
Jobs, and joins children before the parent terminal transition.

Parallel subagent scheduling is work-conserving and uses one orchestrator.
Configured concurrency greater than one is effective only when the backend
reports real process isolation. Worker pool size derives from
`subagents.maxConcurrency` (`N + 1` foreground reserve; supervisor replacement
headroom is not shown as pool). Write tasks use per-child worktrees and
repository-keyed serialized integration.

Delivery policy (ADR 0030 delivery update, 2026-08-30): Host resolves
`SubagentDeliveryIntent` once at admission. Ordinary admitted write subtasks
default to `integrate` / `applyPolicy=auto` when the integrate default is
active; readonly stays `report`; `retainWorktree` does not skip integrate.
Settled worktree children freeze S0/S1 against the lease `baseCommit` (not
parent `HEAD`). Parent apply uses the bounded turn-change writer after
temporary-index three-way prepare. Conflicted/failed worktrees remain retained.

Subagent presentation follows ADR 0046. Model-facing delegation tools are
`piwin_subagent_run` (synchronous spawn+merge convenience),
`piwin_subagent_start` (one task; returns after durable manifest + queued
invocation acceptance), and control tools `piwin_subagent_wait` /
`piwin_subagent_cancel` (1–8 `runIds`; not invocation topology nodes). Each
start or synchronous run owns one durable, revisioned `SubagentInvocation`
keyed to its parent Run and normalized tool call. Wait/cancel rows render from
Host-normalized `ToolPresentation.subagentControl`; Desktop never parses raw
tool output when that field exists. The parent transcript tool position is the
visual anchor; low-frequency `subagent/invocation-updated` pushes carry
lifecycle/latest activity while the ordered child Agent stream carries full
conversation content. Missed-wait settlement is at most one Host-authored
continuation with phase `waiting-subagents` (`joining-descendants` then
`synthesizing-reports`); no fake user row. The run manifest is restart truth
and repairs stale active-looking child records. Child sessions persist in the
index but are excluded from `session/list` and `session/search` (same main-list
rule as SIDE-D9). They remain reachable through the parent transcript inline
panel, right-panel **Tasks** orchestration overview, composer **activity pill**
(async subagents + live `process_start` jobs), and `session/list-children`.
The Terminal tab pairs the zsh PTY with a job-log switcher (not a second
scheduler). The Desktop child inspector reuses normal
transcript/tool/permission/file rendering for observation; there is no
standing apply/retain/discard bar and no composer-adjacent current-work dock
(the activity pill is a compact reachability rail only). Parent-turn review
and undo/redo are Host-owned (`turnChangeUndoV1`; CLI `piwin turn undo|redo`).

Runtime reload is a Host-owned replacement transaction. Settings persistence
records the active and desired revisions separately, then resident sessions
converge automatically with latest-wins semantics. A candidate Blueprint is
compiled from the desired revision, the old generation and all Run descendants
are joined, and the generation handoff publishes only one generation for new
root Runs/tool calls. Failed candidates never replace the active generation;
Desktop/CLI expose the failed state and retry path. Dirty-base parallel writes
default to an explicit one-run `ask` decision; worktrees are retained on
integration conflicts and no automatic retry or conflict resolution is
performed.

## 4. Package map

| Package | Responsibility |
|---------|----------------|
| `@piwin/contracts` | Types, events, config schemas (runtime-light) |
| `@piwin/host-runtime` | Product composition root: Settings compilation, command/push routing, runtime generations, Runs, Jobs, permissions, tools, prompt preparation. Turn execution lives in `session-turn-executor`; Run terminalization lives in `run-terminalizer`; Host egress envelopes live in `host-event-envelope`. |
| `@piwin/agent-host` | Pi-only boundary: SDK backend, isolated worker backend, Pi event/tool adapters, worker protocol, parsed-stream guard for OpenAI-completions. Returns plain `AgentEvent[]` plus one `AgentPromptOutcome`. |
| `@piwin/host-client` | Transport-neutral client facade for Desktop, CLI, Windows, mobile, and Web shells (includes flashcard study controller) |
| `@piwin/host-transport` | JSON framing and browser/Tauri WebSocket transport with connection state and cursor replay requests |
| `@piwin/host-server` | Deployable Host wrapper: loopback/private listener, token auth, safe command admission, replay, health, lifecycle |
| `@piwin/session` | History index, tree projection, naming |
| `@piwin/project` | Workspace/project trust, cwd binding |
| `@piwin/skills` | Discovery, install, defaults, find/create helpers |
| `@piwin/extensions` | Host-owned immutable Pi Extension revisions, registry, and deployment journal |
| `@piwin/mcp` | Config document, MCP Supervisor/ProcessSlot lifecycle, owned transport, metadata catalog |
| `@piwin/tools-web` | `web_search`, `web_fetch` (HTML/PDF extract; long pages may return `spillPath`) |
| `@piwin/git` | Status, diff, commit graph model; worktree integrate prepare; turn-change object/file writer and undo/redo primitives |
| `@piwin/theme` | Theme packages install/apply |
| `@piwin/pet` | Codex pet adapter + state machine |
| `@piwin/artifact` | Fence index, RenderIntent, security, srcdoc/theme policy (Desktop owns iframe scheduling) |
| `@piwin/browser` | Playwright-driven browser session (agent tools + panel mirror + element pick) |
| `@piwin/process` | Non-interactive Job registry, process-tree supervision, logs, readiness |
| `@piwin/media` | Paste store and previews; PromptPreparation validates model-facing media refs |
| `@piwin/voice` | Live call domain + Codex Live adapter (Pi-free); Host owns call authority + upstream events; Desktop owns WebRTC media; auth via openai-codex OAuth (ADR 0065) |
| `@piwin/flashcards` | Unique CardStore; FSRS review JSON; Host-owned study rounds / operation log / catalog (ADR 0018, 0054, 0066). Renderer-safe export: `@piwin/flashcards/study-sequence` |
| `@piwin/notes` | Local markdown notes + FTS/optional vector RAG (ADR 0018) |
| `@piwin/doc-rag` | Folder RAG indexes; registered as folder knowledge bases by Host |
| `@piwin/marketplace` | Unified install sources |
| `@piwin/ui-kit` | Shared UI primitives, including `FlashcardFace` / `TearDeckSurface` (existing `fcws-tear-off` 200ms; no Host/FS) |

## 5. Config root `~/.piwin`

```text
~/.piwin/
  config.json                 # product config (host mode, providers, imageGeneration, Desktop composer/session restore)
  credentials/                # secrets (prefer OS keychain)
  pi-agent/                   # Host-owned Pi runtime: auth.json + catalog cache
  sessions-index/             # SQLite or JSONL index over Pi sessions
  sessions/<session-id>/      # transcript.sqlite3 + leftover non-payload files
  pack-staging/               # non-authoritative pack construction
  cold-storage/transactions/  # offload/restore journals and quarantine (ADR 0044)
  turn-changes/               # Host turn-change store, objects, undo/redo ops
  subagent-runs/              # durable subagent batch/invocation manifests
  worktrees/                  # managed subagent worktree checkouts
  skills/
  extensions/                  # immutable revisions, registry.json, deployment records
  mcp.json
  themes/
  pets/
  media/<session-id>/
  knowledge/
    bases.json               # Host-owned folder knowledge-base registry
  notes/                      # markdown notes (ADR 0018)
  doc-rag/<folderKey>/        # folder RAG cache; rebuilt into the registry if lost
  flashcards/
    cards/                    # item markdown (unique CardStore)
    review/                   # FSRS ReviewState JSON; missing revision = 0
    study/rounds/             # Host study rounds (lazy-created; ADR 0066)
    study/operations/         # idempotent operation log (lazy-created)
  jobs/                       # Job metadata and diagnostic log spool
  logs/
```

Pi native paths remain under `~/.pi/agent/`. piwin maps:

- sessions: prefer Pi session files; maintain index for UI
- subscription OAuth: Host-owned `{PIWIN_ROOT}/pi-agent/auth.json` (not `~/.pi/agent/auth.json`). Ingest is one-way: missing oauth keys from the Pi CLI home, default `~/.piwin` only, never a live-shared `auth.json`.
- Devin subscription (`devin`) is registered in `@piwin/agent-host`, not via a Pi extension. `oauth:devin` reads that same `auth.json` entry for `code_search` (windsurf backend) and the `devin` web-search source. The request shape matches `windsurf-search` (`GetWebSearchResults` on `server.codeium.com`, then `server.self-serve.windsurf.com`). See ADR 0074.
- Host ModelRuntime catalog cache: `{PIWIN_ROOT}/pi-agent/models-store.json`. Online overlay refresh is Host-owned; do not copy the CLI cache.
- skills: product-bound (`bundled`) live in the git repo `skills/` (packaged as `$PIWIN_BUNDLED_ASSETS_ROOT/skills`) and are loaded from that tree — they are not copied into `~/.piwin/skills`. User-installed skills stay under `~/.piwin/skills`; project and mapped roots are additive. Leftover copies of a bundled id under the user dir are ignored. System skills (e.g. `imagegen`) use frontmatter `hidden: true` to stay out of the Skills panel/CLI while remaining loadable by Pi; the `imagegen` skill is toggled via `config.skills.disabledIds` (enables/disables both the skill and the `image_gen` host tool). Default product root also follows read-only `~/.pi/agent` skills (ADR 0060). test-host does not.
- extensions: optional Pi extensions under `extensions/` shipped with piwin, plus read-only `pi-native` follow on the default product root. TUI-only packages are listed and not loaded into the Blueprint.

`config.json` may retain the Desktop's per-next-turn composer profile (model
and thinking effort) and last selected session. These are product settings,
not browser-local presentation preferences. Restoring a project session opens
the project without granting new trust; sending remains gated by its current
trust state. The `imageGeneration` / `videoGeneration` / `speech.asr` config
sections hold **default `ModelRef`s** into `providers[].models`. Image and
video pages may edit that model's generation routes; they do not add, delete,
or retag catalog rows (ADR 0056). `visionDelegation` and `replyWriter` are
optional Host one-shot delegates (pre-turn image describe; post-turn reply
rewrite). They do not start a second Pi session.

## 6. Model protocols

User-configured entries, not hardcoded vendors:

1. `openai-compatible` — baseUrl, apiKey env/ref, models
2. `anthropic-compatible` — baseUrl, apiKey env/ref, models

Host translates config into Pi model/provider registration.

## 7. Rendering pipeline

```text
Assistant message
  → MarkdownView (Streamdown adapter, renderingPhase)
  → projectArtifactMarkdownForRender + indexArtifactFences (one ordinal index)
  → MarkdownCodeFence dispatcher
      → ordinary code / math / mermaid
      → analyzeArtifactFence → RenderIntent
          → materializeArtifact (theme repair on renderSource only)
          → ArtifactInlinePreview → static Shadow DOM or sandbox iframe
          → Canvas launcher (explicit surface="canvas")
  → Image attachments → media preview components
```

`config.artifact.enabled` is the master switch; `config.artifact.scopes`
(`general` / `project` × `inline` / `canvas`) narrows it per session class, and
`resolveArtifactCapability` is the one resolver Host compilation, Desktop
rendering, and Canvas auto-reveal use. Shipped default: Conversation chat on,
Agent chat off. Code-first is Inline-only.
Flashcard tool results are structured transcript projections, not HTML fences.
Copy/export use original model source, never srcdoc. See
[artifact-research.md](./artifact-research.md) and ADR 0005 / 0029.

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

### 7.1 Desktop renderer retention invariants

The durable transcript remains Host/session state; mounted React/WebKit nodes
are only a bounded projection of that state. Desktop groups messages into
stable turn units. Non-empty transcripts use one dynamic-height virtualizer
that mounts the visible range plus eight-turn overscan and the newest three turns.
Scroll-driven range changes commit synchronously for both idle and streaming
sessions, so a fast history scroll cannot expose an unmounted viewport while
React defers the range update. ResizeObserver measurements do not wait for rAF.
TranscriptViewport, follow-tail, History Ticks, and the
virtualizer share one scroll-element port. Scroll offsets and measured turn
heights are bounded presentation caches per session and are cleared when that
session is deleted.

Ordinary session opens start at the latest tail. Structure/stream updates
remeasure mounted turn bodies without clearing the virtualizer's exact size
cache; unchanged bodies may never emit another resize event. After measured
slot heights commit, the viewport corrects follow-tail in a layout effect
before paint. User scroll-away and explicit history jumps still take priority.
The shared scroll port publishes its mounted element through React state in
a layout effect; a ref assignment alone cannot wake a newly mounted list.

First-open presentation covers the transcript with an `Opening conversation…`
state while the mounted content lays out. After the snapshot arrives it waits
at least 300 ms, then reveals at the tail after 180 ms of stable geometry/DOM
with measured tail slots and loaded inline media. A 1600 ms layout deadline
performs a final tail pin and reveals even if a preview remains pending; network
waiting is separate. The guard runs once per opened viewport and never covers
ordinary subsequent updates, blank new sessions, or explicit history views.
The content stays laid out but hidden and inert during preparation.

Heavy content has independent retention bounds:

- collapsed thinking and completed historical tool bodies are unmounted;
- canonical tool output and `ToolPresentation.output.text` share one redacted,
  exact UTF-8 256 KiB projection rather than retaining duplicate uncapped
  strings;
- streaming code fences stay plain while their source is changing; Shiki
  highlighting starts only for terminal/static Markdown;
- `ResizeObserver` remeasures mounted turns after expansion, media/artifact
  load, editing, or font/theme-driven layout changes.

Optional renderer surfaces follow the same ownership rule:

- session navigation hydrates one Host-bounded `session/list` projection per
  scope (Desktop requests `maxItems: 2000` with Host-owned `order`; optional
  `totalCount` / `truncated` report pre-truncation size). The Desktop bound is
  a client request policy, not a Host-wide cap. Flattened sidebar rows over
  `.sidebar-folder-tree` virtualize when the row count exceeds 60, so mounted
  DOM tracks the viewport rather than the resident index; scrolling issues no
  further session-list RPCs. A truncation hint points users at `session/search`
  when older rows were omitted. `session/list-page` remains available for CLI,
  mobile, and future clients; Desktop does not use it for the session index.
  Infinite scroll must not mean “append forever”. ADR 0039 §5 remote path
  safety and §6/§7 transcript paging are unchanged;
- a completed-session cue in the sidebar is attention-only: terminal pushes add
  it for sessions that are no longer active, while the currently visible
  session never receives a duplicate completion marker;
- only the active non-terminal right-panel body is mounted; an open terminal
  is the explicit temporary exception while `TerminalDock` owns PTY lifetime;
- settings, terminal, browser, file-tree, knowledge, document, and other
  route-like surfaces load through feature JS/CSS boundaries;
- development React User Timing history has a hard renderer-owned budget,
  installed before React render and enforced synchronously at the
  `performance.measure()` write boundary, so a starved interval cannot let
  WebKit retain an unbounded diagnostics timeline;
- the workspace is the sole full-stage backdrop-filter owner; nested stage
  regions do not allocate redundant full-size blur surfaces;
- syntax highlighting imports Shiki when a closed/stable code fence first
  requests tokens (a still-open streaming fence stays plain).

These are renderer safety invariants, not transcript truncation. History and
recovery continue to use the Host-owned canonical state.

### 7.2 Conversation multi-pane ownership

Desktop general Conversation may replace the single stage with a recursive,
binary pane tree (ADR 0063). The tree contains only device-local presentation
state: stable pane ids, general-scope session bindings, split orientation and
ratio, active pane, and optional maximized pane. It is versioned in Desktop
storage, never in `~/.piwin` Host settings or a transcript.

The primary leaf reuses the existing Conversation column. Supplementary leaves
resume their own Host session and maintain isolated transcript, foreground Run,
and composer state. All leaves still issue the same `HostCommand`s and consume
normalized `HostPush` values; no Desktop pane owns Pi or creates a second Host
authority. Project Agent scope deliberately retains the single-stage workbench.

For remote Hosts, Desktop publishes one deduplicated live-subscription union
for all visible leaf session ids. The protocol ceiling is eight, equal to the
per-window pane ceiling. Closing or shrinking a layout removes only that
client-side view and subscription; it never aborts, archives, or deletes a Host
session. See
[`conversation-multi-pane-workspace.md`](./specs/conversation-multi-pane-workspace.md).

## 8. Browser Session

A host-owned, Playwright-driven browser session (`@piwin/browser`, ADR 0020) that
owns **one** Chromium (default headless; `PiwinConfig.browser.headless=false` for
a Host-owned headed window) shared by the agent and the desktop panel — "what
the user sees == what the agent controls". Host can instead attach to an
explicit loopback `PiwinConfig.browser.cdpEndpoint` via Playwright
`connectOverCDP`; after `browser_tabs` select, the same snapshot/click/type/mirror
surface drives that page. Detaching does not close the external browser.
`web_fetch` `fetchFallback: 'browser'` is a **different** Chromium (ADR 0058):
one-shot `renderPageHtml`, no profile, no panel pushes, then the same Readability
extract. Chrome daily-session autoConnect is not shipped. Live headed Host
Chromium and loopback `connectOverCDP` (throwaway Chrome, Host dispose does not
kill it) were recorded on `79318f5c` in
[`docs/evidence/2026-09-08-host-browser-smoke-79318f5c.md`](./evidence/2026-09-08-host-browser-smoke-79318f5c.md).

- **Workbench** — the desktop `BrowserSessionPanel` is an interactive mirror of
  the same Chromium: Playwright `page.screencast` JPEG frames (~12 fps) falling
  back to screenshot frames, plus pointer/IME forwarding (`browser/input`).
  Default mode is Interact; pick remains a modifier that attaches a composer chip.
  Desktop opens the right-sidebar Browser tab when the agent acquires the page
  or navigates. The Host CSS viewport defaults to **1280×800**; Host-owned
  Chromium rasters at deviceScaleFactor 2 and the screencast JPEG is CSS×DSF
  (quality 80). The panel scales with `object-fit: contain` and does not shrink
  the page to the inspector box.
- **Controller lock** — `idle | user | agent` (ADR 0057). Write tools auto-acquire
  `agent` from idle. The human takes over explicitly; the agent never auto-steals.
  If the user holds the page, write tools return `browser-user-has-control`.
  A second Run cannot steal an agent lock (`browser-agent-has-control`).
  Streaming a coding turn is **not** the lock. The run that first acquired
  `agent` releases that claim when it terminals; other runs do not.
  Chromium death is recovered once per fault (page vs context/browser); dispatched
  writes are not replayed. Closing the panel does not kill a run that still holds
  the claim.
- **Agent tools** — `browser_navigate` / `browser_snapshot` / `browser_click` /
  `browser_type` / `browser_fill_form` / `browser_scroll` / `browser_screenshot` /
  `browser_find` / `browser_back` / `browser_forward` / `browser_wait` /
  `browser_lock` / `browser_status` / `browser_restart` / `browser_reload` /
  `browser_press_key` / `browser_wait_for` / `browser_viewport` /
  `browser_hover` / `browser_select_option` / `browser_set_checked` /
  `browser_tabs` / `browser_dialog` / `browser_upload` / `browser_console` /
  `browser_network` are first-class
  model-visible tools (not `piwin_toolbox` targets), registered by
  `@piwin/host-runtime`. Tabs keep a stable `pageId`; popups are listed and not
  auto-selected. Dialogs accept/dismiss with a timeout instead of hanging.
  Uploads take Host-accessible paths through file permission; downloads persist
  as Host file refs. Console/network query a bounded ring buffer. Snapshots
  use the **same ref grammar as `@playwright/mcp`**: `locator('html').ariaSnapshot({
  mode: 'ai', boxes: true })` emits `[ref=eN]` + `[box=x,y,w,h]` annotations, and
  refs resolve via `locator('aria-ref=e5')`. The snapshot output is **not** parseable
  YAML (plain scalars with inline annotations; the `yaml` parser folds the indented
  children), so `@piwin/browser` derives the tree with a small dedicated line
  parser — no `yaml` dependency and no `page.accessibility` (removed in
  Playwright 1.x).
- **Panel mirror** — `browser/frame` width/height are CSS viewport px. Local
  sidecar carries an `inline` JPEG data URL; a remote Host sends metadata on
  the JSON control channel and the JPEG on the same authenticated WebSocket
  (`browserFrameBinary` capability, `PBF1` envelope). Console and
  network events are captured while a desktop mirror lease is held and shown in a
  collapsible drawer.
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
- **Chromium** — not shipped inside the Desktop package. Host owns
  `~/.piwin/playwright` (`PLAYWRIGHT_BROWSERS_PATH`) and downloads Playwright
  `chromium --only-shell` (~190MB) on first headless browser use. Headed mode
  downloads full Chromium instead. `piwin doctor` reports whether that cache
  has a matching binary. Desktop UI e2e still uses `pnpm --dir apps/desktop
  e2e:install` for the Playwright test runner.

## 9. Tauri desktop shape

```text
apps/desktop/
  index.html           # Main Desktop composition root
  pet-overlay.html     # Cosmetic overlay composition root
  src/                 # React UI and separate main/overlay entries
  src-tauri/           # Rust shell: windowing, FS bridges, OS integrations
```

The pet overlay uses its own Vite HTML/React entry and minimal stylesheet. It
must not import the main Desktop composition root or its Markdown, settings,
artifact, transcript, and shell graph merely to branch on the Tauri window
label at runtime. Shared leaf modules are allowed; the overlay remains a
separate cosmetic WebContent page with no Host/session authority.

The native shell creates that cosmetic window hidden. Once the dedicated page
and transparent stylesheet are ready, the page applies the Desktop-local saved
visibility preference through the existing native show/hide commands. The
hover close control and Settings → Pets switch share that preference; neither
changes pet selection or Host-owned pet state.

Local Tauri development and Vite use the explicit `127.0.0.1:1420` origin.
Using one address family makes strict-port enforcement authoritative and avoids
split asset/HMR routing between simultaneous IPv4 and IPv6 `localhost`
listeners. `TAURI_DEV_HOST` remains the explicit remote-development override.

Tauri main process / commands call into a Node Host Server, either as a local
sidecar or as a configured remote Host through the public HostClient.

**Local recommendation**: Node Host Server sidecar process owned by Tauri; UI
talks over local IPC/JSON events. The same Host Server entry point can later be
run independently and reached by other shells.

Alternative (simpler CLI smoke): CLI embeds HostRuntime in-process. The
multi-client target is a single long-lived Host Server per data root, with CLI
connecting to it when one already exists.

## 9.1. Tauri mobile shape

    apps/mobile/
      src/                 # React mobile shell and Host-client views
      src-tauri/           # Minimal Rust shell; no Node sidecar or PTY

The mobile shell connects to a remote or private-network Host through the
public HostClient/HostTransport surface. Its local capabilities are limited to
mobile OS integration such as secure credential storage, camera/file pickers,
and notifications. It never imports Pi packages or receives Host absolute
paths.

Flashcard catalog and study pages are first-class Mobile routes (`#flashcards`,
`#flashcards/study/<roundId>`), not chat-only Q/A. v1 Mobile study is
**online-only** against the same Host. Source preview is title + excerpt;
the client must not call `doccards/open-source` or display Host filesystem
paths. System back / lock / landscape on real devices is **not** yet evidenced
(ADR 0066 verification incomplete).

## 10. CLI shape

```text
apps/cli → @piwin/host-client / @piwin/host-transport → Host Server
```

Commands mirror Host capabilities; no separate business logic. A CLI may use an
in-process HostRuntime for a one-shot/local smoke path, but the multi-client
target is to attach to the same long-lived Host Server as Desktop and mobile.

`piwin study` (alias `piwin cards study`) uses the same `flashcards/study/*`
commands. It has **no tear animation and no touch** on purpose; checkpoint
before `rate`; progress is the Host snapshot. It must not `createStudyService`
or open a second CardStore.

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
| Local Host deployment | Tauri-owned Host Server sidecar |
| Remote Host deployment | Standalone Host Server over private transport |
| Optional network relay | Gateway/tunnel only; never the Agent authority |

## 14. Capability honesty (2026-07-24)

| Layer | States (truthful labels) | Notes |
|-------|--------------------------|-------|
| **Desktop transport** | Browser mock · Tauri sidecar | Browser Playwright uses mock host. Tauri uses a **two-tier** spawn (ADR 0017): packaged Node sidecar + `host/host-serve.mjs` when present, else workspace `pnpm`/`tsx` (dev). Packaged path still requires **S5 clean-machine smoke** before claiming public distribution readiness. Wire-protocol rules: [`ipc-transport-discipline.md`](./ipc-transport-discipline.md). |
| **Agent backend** | mock session · SDK in-process · RPC worker isolated | UI never claims a live model when mock is active. Until Runtime Refactor Phase 3 exits, any fallback is labeled transitional and not isolated. |
| **Desktop host mode** | SDK in-process · RPC worker isolated when available | Desktop must report actual backend and isolation capability; it must not infer isolation from configured `hostMode` alone. |
| **Terminal** | Tauri PTY authorized · unavailable | Interactive Terminal is a **desktop capability** (ADR 0013). Host `capabilities.pty` and remote transport are **not** proof that Tauri Terminal is unavailable. |
| **Jobs** | starting · running · ready · terminal | Non-interactive process state comes from JobController; interactive Terminal remains Tauri-owned. |
| **Provider** | unconfigured · credential unavailable · configured | Best-effort status only. Provider readiness must **not** gate workspace browse/trust (PSR D7). |
| **Packages** | `memory`, `process`, `automation` first-class | Product commands route through host-runtime; Advanced/Experimental in Desktop Settings. |
| **Evidence coverage** | browser mock · live JSONL sidecar · native macOS | [See automated prerequisites](../README.md#automated-prerequisite-sequence) and [trace recipe](plans/2026-07-24-responsiveness-trace-recipe.md). Automated prerequisites are not a release candidate; a separately reviewed dated native macOS evidence manifest is required before declaring one. |
| **Subagent delivery / turn undo** | `subagentDeliveryV1` · `subagentResultReviewV1` · `turnChangeUndoV1` | Host advertises these true when the delivery default, result freeze path, and turn-change runtime are present. Clients must not invent UI from version strings alone. |
| **Flashcard study** | in-tree · device/visual evidence pending | ADR 0066. Desktop page, Mobile catalog+study, CLI `piwin study`, Host rounds/operations. **Not** dual-device verified; Mobile is excerpt-only / online-only; CLI has no animation. |

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

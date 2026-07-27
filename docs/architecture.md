# piwin Architecture

| Field | Value |
|-------|-------|
| Status | Draft v0.1 |
| Date | 2026-07-19 |
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
│ Application services (no UI frameworks)                      │
│  session · project · skills · mcp · marketplace              │
│  git · theme · pet · artifact · media · tools-web            │
├─────────────────────────────────────────────────────────────┤
│ Agent Host                                                   │
│  Session lifecycle · event bus · permission policy           │
│  Adapters: PiSdkAdapter | PiRpcAdapter                       │
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
apps/*  →  packages/* (application + host + contracts)
packages/* (except contracts)  →  packages/contracts
packages/agent-host  →  Pi packages (only place allowed)
apps/*  ↛  Pi packages
```

Violations are architecture bugs.

## 3. Dual-mode Agent Host

### 3.1 Why both

| Mode | Use | Pros | Cons |
|------|-----|------|------|
| **SDK** (`PiSdkAdapter`) | Default Desktop main / Node CLI | Low latency, full events | Shares process with host |
| **RPC** (`PiRpcAdapter`) | Isolation, external IDE clients, crash boundary | Process isolation | JSONL overhead |

v1: **both adapters exist** behind `AgentHost` / `SessionHandle`. Default runtime = SDK. RPC used by `piwin rpc` and optional "isolated session" setting.

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

### 3.3 Event model

Host normalizes Pi SDK events and RPC events into one `AgentEvent` union:

- `session/*` lifecycle
- `message/*` start/update/end (text, thinking)
- `tool/*` start/update/end
- `permission/*` request/resolved
- `compaction/*`
- `error`

Presentation only consumes `AgentEvent`.

### 3.4 Permission policy

Host-owned (not UI):

- bash danger patterns
- writes to secrets (`.env`, keys)
- network tools (search/fetch/mcp)
- destructive git

Modes: `allow` | `ask` | `deny`, with project-scoped remember.

## 4. Package map

| Package | Responsibility |
|---------|----------------|
| `@piwin/contracts` | Types, events, config schemas (runtime-light) |
| `@piwin/agent-host` | Host + SDK/RPC adapters + permission |
| `@piwin/session` | History index, tree projection, naming |
| `@piwin/project` | Workspace/project trust, cwd binding |
| `@piwin/skills` | Discovery, install, defaults, find/create helpers |
| `@piwin/mcp` | Config document, client lifecycle, tools bridge |
| `@piwin/tools-web` | `web_search`, `web_fetch` providers |
| `@piwin/git` | Status, diff, commit graph model |
| `@piwin/theme` | Theme packages install/apply |
| `@piwin/pet` | Codex pet adapter + state machine |
| `@piwin/artifact` | Markdown helpers + HTML artifact runtime (from openwebui_m) |
| `@piwin/media` | Paste store, previews, path injection for text models |
| `@piwin/marketplace` | Unified install sources |
| `@piwin/ui-kit` | Shared desktop UI primitives |

## 5. Config root `~/.piwin`

```text
~/.piwin/
  config.json                 # product config (host mode, providers, Desktop composer/session restore)
  credentials/                # secrets (prefer OS keychain)
  sessions-index/             # SQLite or JSONL index over Pi sessions
  skills/
  mcp.json
  themes/
  pets/
  media/<session-id>/
  logs/
```

Pi native paths remain under `~/.pi/agent/`. piwin maps:

- sessions: prefer Pi session files; maintain index for UI
- skills: bundled + `~/.piwin/skills` + optional maps to other harness skill dirs
- extensions: optional Pi extensions under `extensions/` shipped with piwin

`config.json` may retain the Desktop's per-next-turn composer profile (model
and thinking effort) and last selected session. These are product settings,
not browser-local presentation preferences. Restoring a project session opens
the project without granting new trust; sending remains gated by its current
trust state.

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
  → text-model path: inject absolute path string into model-facing text
  → vision path (later): image content parts when protocol + model support
```

## 8. Tauri desktop shape

```text
apps/desktop/
  src/                 # React (or chosen web UI)
  src-tauri/           # Rust shell: windowing, FS bridges, OS integrations
```

Tauri main process / commands call into Node host **or** a long-lived host sidecar.

**v1 recommendation**: Node host sidecar process owned by Tauri; UI talks over local IPC (JSON events). Same host binary used by CLI.

Alternative (simpler smoke): CLI embeds host in-process; Desktop spawns `piwin host --mode sdk|rpc`.

## 9. CLI shape

```text
apps/cli → @piwin/agent-host + services
```

Commands mirror host capabilities; no separate business logic.

## 10. Testing strategy

| Layer | Tests |
|-------|-------|
| contracts | type-level / schema validation |
| artifact/media/git pure logic | vitest unit tests |
| agent-host adapters | integration with mocked Pi / recorded RPC |
| desktop critical flows | playwright later |

## 11. Evolution rules (anti-shitpile)

1. New feature → ADR if it crosses packages
2. Contracts first, then package, then app wiring
3. No cross-import of app code from packages
4. Marketplace installs only through `@piwin/marketplace`
5. Prefer deleting code over "temporary" helpers that become permanent

## 12. Open implementation choices (tracked)

| Topic | Current lean |
|-------|----------------|
| Desktop UI kit | React + Vite inside Tauri |
| Session index DB | SQLite |
| Default host mode | SDK |
| Sidecar vs in-process for Tauri | Sidecar host process |

## 12. Capability honesty (2026-07-24)

| Layer | States (truthful labels) | Notes |
|-------|--------------------------|-------|
| **Desktop transport** | Browser mock · Tauri sidecar | Browser Playwright uses mock host; Tauri spawns workspace `pnpm`/`tsx` host bridge. **Developer preview only** — no bundled Node runtime for installed apps yet (PSR D1; plan: ADR 0017). Wire-protocol rules: [`ipc-transport-discipline.md`](./ipc-transport-discipline.md). |
| **Agent backend** | mock session · SDK · SDK fallback | UI never claims a live model when mock is active. RPC custom-tools may fall back to SDK (ADR 0011). |
| **Desktop host mode** | **SDK-only preview** | Desktop does **not** honor a selectable RPC `PiwinConfig.hostMode`. RPC remains CLI/host architecture until isolation worker ships (ADR 0012). |
| **Terminal** | Tauri PTY authorized · unavailable | Interactive Terminal is a **desktop capability** (ADR 0013). Host `capabilities.pty` is **not** proof that Tauri Terminal is unavailable or available. |
| **Host shell preview** | `capabilities.shellPreview` | Line-oriented host shell remains for non-Tauri / mock paths. |
| **Provider** | unconfigured · credential unavailable · configured | Best-effort status only. Provider readiness must **not** gate workspace browse/trust (PSR D7). |
| **Packages** | `memory`, `process`, `automation` first-class | Host domain commands; Advanced/Experimental in Desktop Settings. |
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
2. **ADR 0012 true RPC worker isolation:** SDK fallback remains compatible but
   is not process isolation. The worker strategy needs separate contracts,
   lifecycle design, and failure semantics.
3. **Follow-up turn lifecycle:** `session/follow_up` now validates run
   ownership, but a distinct foreground lifecycle is not introduced here.
   Decide in a separate ADR/plan whether it appends to an existing run or
   starts a new run with its own `runId` and terminal event.

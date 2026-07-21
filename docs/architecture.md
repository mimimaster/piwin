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
  config.json                 # product config (host mode, providers, UI)
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

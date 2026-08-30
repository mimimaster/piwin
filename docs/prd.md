# piwin Product Requirements Document

| Field | Value |
|-------|-------|
| Product | **piwin** |
| Status | Draft v0.2 (locked decisions applied) |
| Date | 2026-07-19 |
| Visibility | Private first |
| Base kernel | [Pi Agent Harness](https://github.com/earendil-works/pi) |
| Desktop | Tauri 2 |
| Config root | `~/.piwin` |

---

## 1. Locked decisions

1. **Name**: piwin
2. **Desktop**: Tauri 2
3. **Config**: `~/.piwin` independent product root; map/overlay Pi resources (`~/.pi/agent/...`) without forking Pi upgrade path
4. **Agent host**: dual-mode from day one — **SDK in-process** + **RPC subprocess** adapters behind one interface (implementations can be coarse, contracts complete)
5. **Models**: user-configured providers; default protocol surface supports **OpenAI-compatible** and **Anthropic-compatible** (not vendor lock-in)
6. **Open source**: private first
7. **Rendering**:
   - Default message body: **Markdown**
   - On top of Markdown: **HTML Artifact** (research/port from local `openwebui_m`, not reinvent)
   - **Image preview** in chat (Codex-like)
   - **Paste image into composer** → save under local media store → for text models, send **local file path** (not base64 dump)
8. **Repo**: `~/Projects/piwin`

---

## 2. Product vision

> piwin is a private coding-agent **shell** on Pi: clear layering, a deployable
> Host, multi-client contracts, and pluggable Skills/MCP/Theme/Pet/Artifact/Media
> — engineered to grow without becoming a garbage pile.

### Goals

- Ship a usable Agent Window with project layering + history
- Ship CLI that shares host, config, and sessions with Desktop
- Keep the Host deployable independently so future Desktop, Windows, mobile,
  and Web shells can connect to one Host
- Treat Skills / MCP / Theme / Pet / Artifact / Media as first-class packages
- Prefer adapters over forking Pi

### Non-goals (v1)

| Non-goal | Why |
|----------|-----|
| Full IDE (LSP, debugger, multi-file editor) | Agent shell, not Cursor clone |
| Cloud multi-tenant | Local single-user first |
| Cursor-style tab completion | Out of agent mainline |
| Built-in model inference service | BYOK / local OpenAI-compatible servers |
| Mobile | No mobile shell in v1; the Host-first protocol must leave room for it |

---

## 3. Architecture summary (see architecture.md)

```text
Client shells: Desktop (Tauri) | CLI | future Windows/mobile/Web shells
Host Server:   transport | auth | client admission | push/replay | health
Product Host:  @piwin/host-runtime composition root
Application:   session / project / marketplace / git / theme / pet / artifact / media services
Agent Host:    dual adapter (SDK | RPC) + permission + event bus
Capabilities:  tools | skills | mcp | web | models
Kernel:        Pi (pi-ai / pi-agent-core / pi-coding-agent)
Platform:      FS / Git / Process / Net / Keychain (Host-owned)
```

**Hard rule**: Client shells never import Pi package internals. They use the
public HostClient/contracts surface; only the Host composition reaches
`@piwin/agent-host`.

---

## 4. Feature requirements

### 4.1 Agent Window (P0)

| ID | Requirement | Priority |
|----|-------------|----------|
| AW-01 | Open project / bind cwd | P0 |
| AW-02 | Project layering: Workspace → Project → Session → Message tree | P0 |
| AW-03 | Session history per project | P0 |
| AW-04 | Chat stream: markdown, tools, thinking | P0 |
| AW-05 | Session tree UI (Pi JSONL tree; native active-leaf projection remains a later spike) | P1 |
| AW-06 | New / Resume / response-level Fork / whole-session Duplicate / Rename / Delete | P0 |
| AW-07 | Model + thinking level controls | P0 |
| AW-08 | Abort / Steer / Follow-up | P1 |

**Layer model**

```text
Workspace (optional collection)
└── Project (git root / cwd)
    ├── Context (rules, skills, mcp bindings)
    ├── Sessions (Pi JSONL tree + piwin index)
    └── Project-scoped resources (optional)
```

**Session branching clarification (2026-08-04):** AW-06 product Fork creates a
linked product session from a selected completed assistant response; Duplicate
creates an independent complete copy. Neither operation waits for AW-05 Pi
native JSONL tree support. See
[`session-fork-product-adaptation.md`](./specs/session-fork-product-adaptation.md).

### 4.1.1 Conversation multi-pane workspace (P1)

| ID | Requirement | Priority |
|----|-------------|----------|
| CW-01 | General Conversation may show 1/2/4/8 independent Chat panes in one Desktop window | P1 |
| CW-02 | Focused pane supports split right/down, close, maximize, directional focus, and resize by keyboard and visible controls | P1 |
| CW-03 | Pane geometry is device-local; sessions, Runs, transcripts, and prompts remain Host-owned | P0 |
| CW-04 | Project Agent keeps the single-stage workbench; it is not admitted into Chat panes | P0 |
| CW-05 | Every visible pane remains live remotely through one bounded, deduplicated subscription set | P1 |

The accepted behavior and keyboard contract are specified in
[`conversation-multi-pane-workspace.md`](./specs/conversation-multi-pane-workspace.md)
and ADR 0063.

### 4.2 Skills panel (P0)

| ID | Requirement | Priority |
|----|-------------|----------|
| SK-01 | List bundled / user / project skills | P0 |
| SK-02 | Search + install from marketplace sources | P0 |
| SK-03 | Enable/disable + scope | P0 |
| SK-04 | Validate SKILL.md | P0 |
| SK-05 | Default install set (Cursor-inspired baseline) | P0 |
| SK-06 | `find-skill` | P0 |
| SK-07 | `create-skill` | P0 |
| SK-08 | Optional load maps for `~/.cursor/skills`, `~/.codex/skills`, `~/.claude/skills` | P1 |

**Default bundled skills (v1 draft)**

- `create-skill`, `find-skill`
- `create-rule` / project AGENTS.md helpers
- `systematic-debugging`, `writing-plans`, `executing-plans`
- `requesting-code-review`, `using-git-worktrees`
- `verification-before-completion`
- `hatch-theme`, `hatch-pet`
- `web-research` (how to use web_search/fetch)

### 4.3 MCP panel (P0)

| ID | Requirement | Priority |
|----|-------------|----------|
| MCP-01 | Server list, start/stop, health | P0 |
| MCP-02 | Marketplace install | P1 |
| MCP-03 | Form + schema validation | P0 |
| MCP-04 | Raw JSON editor | P0 |
| MCP-05 | tools/list preview | P0 |
| MCP-06 | User vs project override | P0 |
| MCP-07 | `${ENV}` refs; secrets not shown plaintext | P0 |

Config shape compatible with Cursor/Claude style `mcpServers` map.

### 4.4 Git (P1)

| ID | Requirement | Priority |
|----|-------------|----------|
| GIT-01 | Branch + dirty status | P0 |
| GIT-02 | Diff summary for UI + agent context | P0 |
| GIT-03 | Commit graph visualization | P1 |
| GIT-04 | Select commit → message/diff | P1 |
| GIT-05 | Stage/commit/branch (confirm) | P2 |

Note: **Pi session tree ≠ git commit tree** — separate UI panels.

### 4.5 Theme / skins (P1)

| ID | Requirement | Priority |
|----|-------------|----------|
| TH-01 | Theme package format + library | P1 |
| TH-02 | Switch + preview | P1 |
| TH-03 | Marketplace install | P2 |
| TH-04 | `hatch-theme` skill generates + installs | P1 |

### 4.6 Pets (P1, Codex-compatible)

| ID | Requirement | Priority |
|----|-------------|----------|
| PET-01 | Load Codex-compatible pet packages | P1 |
| PET-02 | Bind animations to agent state | P1 |
| PET-03 | Install/remove/enable | P1 |
| PET-04 | `hatch-pet` skill | P2 |
| PET-05 | Import/export `~/.codex/pets` | P1 |

Package contract (community):

```text
pet.json + spritesheet.webp
~1536x1872, 8x9 cells of 192x208
states: idle, running-*, waving, jumping, failed, waiting, running, review
```

### 4.7 Pi capability gaps to close

| Gap | Plan | Priority |
|-----|------|----------|
| No GUI | Tauri shell | P0 |
| No web tools | `tools-web` | P0 |
| No permission system | Host PermissionPolicy | P0 |
| MCP not first-class UI | `mcp` package + panel | P0 |
| No marketplace UI | `marketplace` | P0/P1 |
| No git UI | `git` package | P1 |
| No sub-agents | multi-session first; sub-agent later | P2 |
| No plan mode | Application-layer plan artifact | P1 |

### 4.8 Web search & fetch (P0)

| Tool | Role |
|------|------|
| `web_search` | Query → titles/snippets/urls/citations; pluggable providers |
| `web_fetch` | URL → readable text; size/timeout/redirect limits |

Requirements: domain policy, truncation before context inject, citation cards, clear failure when no provider key, disableable if MCP search preferred.

### 4.9 Artifact rendering (P0/P1) — researched

**Default path is Markdown.** HTML is an **artifact capability** layered on chat.

Port strategy from local `~/Projects/openwebui_m` (do not invent a new unsafe renderer):

| openwebui_m module | piwin package target |
|--------------------|----------------------|
| `artifactParser.ts` | `@piwin/artifact` detect fences/aliases |
| `artifactSecurity.ts` | size / external resource block |
| `artifactSrcdoc.ts` | CSP + theme vars + srcdoc wrapper |
| `artifactThemeContract.ts` | theme guard/repair |
| streaming/height/init queue | host-agnostic runtime; UI adapter in desktop |

| ID | Requirement | Priority |
|----|-------------|----------|
| AR-01 | Markdown default rendering | P0 |
| AR-02 | Detect `html` / `artifact-html` (+ aliases) | P0 |
| AR-03 | iframe sandbox preview | P0 |
| AR-04 | Source + preview dual view | P0 |
| AR-05 | Streaming-safe preview policy | P1 |
| AR-06 | Theme contract injection | P1 |
| AR-07 | Fullscreen / side artifact panel | P1 |
| AR-08 | Export HTML to project file | P1 |
| AR-09 | Unit tests ported from openwebui_m policies | P0 |

Security baseline (from openwebui_m v1.1):

- completed inert HTML/SVG uses sanitized Shadow DOM natural flow; JavaScript,
  embeds/external references, Canvas, and streaming content use a sandboxed
  iframe + strict CSP
- block external CDN by default
- max size (e.g. 100KB configurable)
- ready timeout
- copy/export = **raw model source**, never wrapped srcdoc

See [artifact-research.md](./artifact-research.md).

### 4.10 Media / images (P0)

| ID | Requirement | Priority |
|----|-------------|----------|
| MED-01 | Render image attachments/previews in chat bubbles | P0 |
| MED-02 | Paste image into composer | P0 |
| MED-03 | Persist paste to `~/.piwin/media/<session-id>/<uuid>.<ext>` | P0 |
| MED-04 | Text-model prompt path: inject **absolute local path** (+ optional mime/size meta) | P0 |
| MED-05 | Vision-capable protocol path: optional image content parts (later toggle) | P1 |
| MED-06 | Drag-drop images into composer | P1 |
| MED-07 | Thumbnail cache + lazy load | P1 |

**Text-model contract (v1 default)**

```text
User pasted image → saved to disk
Composer shows thumbnail
Outbound user message includes:
  - visible caption / user text
  - structured attachment: { type: "image", path: "/Users/.../.piwin/media/...", mime, bytes }
Model-facing text (text-only providers):
  "User attached image: /absolute/path/to/file.png (image/png, 1280x720)"
```

Do **not** dump base64 into context for text models.

### 4.11 piwin Live (P1)

Bound realtime voice on a work session. First-period channels: **openai-codex
subscription OAuth** and **Gemini API key**. Product:
[2026-08-28-codex-live-product.md](./specs/2026-08-28-codex-live-product.md);
channels/settings: [2026-08-29-live-provider-adapter.md](./specs/2026-08-29-live-provider-adapter.md);
ADR [0065](./adr/0065-piwin-live-voice-work-session.md).

| ID | Requirement | Priority |
|----|-------------|----------|
| LIVE-01 | Codex: Accounts openai-codex login. Gemini: Host-held API key. No Platform `realtime-audio` picker; no Live Enable toggle | P1 |
| LIVE-02 | Desktop owns media (WebRTC or PCM WebSocket by `mediaDriverId`). Host holds long-lived credentials and the call. Owner start response may include one-shot bootstrap (SDP answer or Gemini ephemeral token) | P1 |
| LIVE-03 | Upstream client delegation → Host admission → Session/Run/Permission; busy queues | P1 |
| LIVE-04 | One active call per Host; owner-only media controls; others see sanitized status | P1 |
| LIVE-05 | No raw audio persistence; persist only delegated instruction text + source tag | P1 |
| LIVE-06 | Hangup does not cancel an already-admitted Agent Run | P1 |
| LIVE-07 | Accessible Live chrome (keyboard, 44px, screen reader status) | P1 |

**Non-goals (MVP):** Platform Realtime `realtime-audio` catalog; Host PCM relay; CLI/Mobile/Web as mic owners; Voice calling Agent tools directly; keyword delegation.

---

## 5. CLI requirements

Same host, same config root:

```bash
piwin                 # interactive
piwin chat "..."      # one-shot
piwin session list
piwin skill install <id>
piwin mcp add --json ...
piwin doctor
piwin rpc             # host RPC endpoint for external clients
piwin host listen     # planned standalone Host Server entry point
```

---

## 6. Config layout

```text
~/.piwin/
  config.json            # Host-owned product config
  credentials/           # Host-owned; keychain-backed where possible
  sessions-index/       # projection over Pi sessions
  skills/               # or links into mapped Pi skills
  mcp.json
  themes/
  pets/                 # also can read ~/.codex/pets
  media/                # pasted / generated images
  logs/                 # Host logs

~/.pi/agent/            # Pi native (do not break upstream)
  sessions/
  skills/
  extensions/
  settings.json
```

---

## 7. Model protocols (user-configured)

piwin does not hardcode vendors. v1 protocol adapters:

1. **OpenAI-compatible** (`baseUrl`, `apiKey`, `models[]`)
2. **Anthropic-compatible** (`baseUrl`, `apiKey`, `models[]`)

UI: provider form + advanced JSON. Pi's multi-provider stack is used underneath via host adapter.

## 7.1 Host deployment target

The Host is the source of truth for Agent execution and product state. It may
run locally beside a Desktop/CLI shell or independently on a Mac, Windows/Linux
machine, NAS, or server. Other shells connect to that Host over local IPC,
Tailscale/Headscale, WireGuard, a private LAN, or an explicitly configured
tunnel.

The Host owns `~/.piwin`, `~/.pi/agent`, provider secrets, project roots,
sessions, MCP, process/browser capabilities, and runtime state. Clients receive
state through `HostCommand` / `HostPush`; they do not replicate the config or
session directories.

The detailed target and implementation gate are in
[`docs/specs/host-server-multi-client.md`](./specs/host-server-multi-client.md)
and [ADR 0036](./adr/0036-host-server-multi-client-deployment.md). The earlier
personal Gateway remains an optional relay/NAT pattern, not a required backend.

---

## 8. Milestones

### M0 — Skeleton (now → ~1.5w)

- monorepo + contracts + dual-mode host stubs
- docs (PRD/arch/ADR)
- minimal CLI + Tauri shell smoke

### M1 — Agent Window MVP

- project open, session history, markdown chat, tools cards
- permission prompts
- web_search / web_fetch
- media paste + path injection

### M2 — Extensibility

- Skills panel + defaults + find/create-skill
- MCP panel + JSON
- marketplace local/git sources

### M3 — Differentiation

- HTML artifact (port openwebui_m runtime)
- git status/diff + commit graph
- theme system + hatch-theme

### M4 — Fun + polish

- pet runtime + Codex import
- hatch-pet
- UX/performance/doctor

---

## 9. Success criteria

1. CLI and Desktop share config root and can resume same project sessions
2. Install one skill + one MCP; model can call tools; UI shows them
3. Main path: open project → edit via tools → run commands → see diff
4. Markdown renders; HTML artifact previews when applicable
5. Paste image → appears in composer → stored locally → text model sees path
6. New contributor can point to the correct package for "skill marketplace" in 30 minutes

---

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Fork Pi | Official packages + adapters only |
| UI FS spaghetti | Application services only |
| Artifact XSS | Port openwebui_m security, sandbox/CSP |
| Marketplace supply chain | Pin versions, review install scripts |
| Scope creep | Enforce non-goals + milestones |

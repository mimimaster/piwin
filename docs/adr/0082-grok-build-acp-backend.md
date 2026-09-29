# ADR 0082: Grok Build as a second session backend over ACP

| Field | Value |
|-------|-------|
| Status | **Accepted** — implementation in progress on `feat/grok-acp-backend` |
| Date | 2026-09-29 |
| Related | [ADR 0003](./0003-dual-mode-host.md), [ADR 0036](./0036-host-server-multi-client-deployment.md), [ADR 0040](./0040-host-session-runtime-residency.md), [ADR 0051](./0051-host-owned-run-interventions.md), [ADR 0077](./0077-github-extension-registry.md) |
| Product spec | `docs/specs/2026-09-29-grok-build-feature-mapping.md` (local, git-ignored) |
| Evidence | `docs/specs/evidence/2026-09-29-grok-acp-handshake-probe.md` (local, git-ignored) |

## Context

piwin runs every session on Pi through `@piwin/agent-host`. The product owner
wants Grok Build (`grok` CLI, xAI) available in the same UI: same composer,
transcript, tool cards, approval cards, Changes panel and session list.

Grok exposes the Agent Client Protocol over stdio (`grok agent stdio`,
JSON-RPC 2.0, one message per line). Live probes against `grok 1.0.41` and
`1.0.44` established the wire behavior this ADR depends on:

- Standard ACP: `initialize`, `session/new|load|resume|list|prompt|cancel|
  set_mode|set_config_option`, `session/update` notifications,
  `session/request_permission` requests.
- xAI extensions are sent with a leading underscore (`_x.ai/...`), unlike the
  published docs. `set_config_option` takes a plain string `value`.
- Session catalog: `_x.ai/sessions/list` (all sessions, including ones created
  in the Grok TUI), `_x.ai/session/rename`, `_x.ai/session/delete` (immediate,
  permanent), `_x.ai/sessions/changed` push.
- Interjection: `_x.ai/interject { text }` applies at the next step of the
  running turn and returns only `{ status: "queued" }`.
- Grok's own prompt queue exists but cannot be edited, reordered or cleared
  over ACP.
- `session/load` replays history without message ids; `session/resume` does
  not replay.
- `_x.ai/mcp/servers_updated` carries MCP server `env` values in clear text,
  including API keys.
- The CLI auto-updates between runs.

## Decision

### 1. Grok follows Grok

A Grok session behaves as it would in the Grok TUI. piwin does not override
the user's Grok permission configuration, does not inject Pi system prompts,
Host tools, Pi MCP servers, Skills or provider credentials, and exposes every
mode and slash command Grok reports. piwin renders; Grok decides.

Permission approvals use Grok's own option ids and labels. They are not
translated into piwin remembered-permission rules and never pass through the
piwin permission rule engine. The UI must say so; it must never present Grok
execution as a piwin sandbox.

### 2. New package `@piwin/acp-agent`

An application package that owns:

- a JSON-RPC 2.0 line connection over an injected transport port (no
  `child_process`, no Pi imports);
- the ACP client (requests, notifications, agent→client requests, timeouts,
  cancellation);
- Grok projection: ACP/xAI events → normalized `AgentEvent`,
  `ToolPresentation`, permission prompts, usage, session catalog records;
- mandatory redaction: notifications that carry secrets are dropped before
  they reach any caller.

`host-runtime` injects the process port (spawns `grok agent stdio`) and
composes the package. `agent-host` stays Pi-only and gains no "Grok mode".

### 3. Backend routing in host-runtime

Sessions carry a durable backend binding (`agentId`, `backendSessionId`,
observed CLI version). A record without a binding is Pi, unchanged. An unknown
or unavailable agent id never falls back to Pi.

`host-runtime` routes create / prompt / cancel / resume / delete by binding.
Grok sessions do not pretend to be Pi `SessionHandle`s with fake `steer` or
`getTree`; unsupported operations are rejected by the Host and hidden by
clients through a per-session capability descriptor.

### 4. The session list maps Grok sessions directly

The Grok catalog is the source of truth for Grok session existence, title and
activity. piwin lists every Grok session (including TUI-created ones), groups
them by working directory, and writes rename and delete back to Grok. Delete
is permanent in both places. Pin and archive are piwin-local.

The piwin transcript is a display projection. First open (no local
projection) or a newer Grok `lastChangeUnixMs` rebuilds it with
`session/load`; otherwise `session/resume` continues without replay.

### 5. Queue and interjection

piwin's Host-owned queued turns (ADR 0051) remain the only queue the user
manages. The Host hands Grok one prompt at a time, so Grok's internal queue
stays empty. Run interventions map to `_x.ai/interject`; because Grok gives
no applied acknowledgement, the intervention is reported as delivered, not
applied.

### 6. Secrets and identifiers

`_x.ai/mcp/servers_updated`, `_x.ai/settings/update` and
`_x.ai/announcements/update` are dropped at the connection boundary and never
logged, persisted or pushed. MCP status is projected as name, transport,
status and reason only. `hostname` and `agentId` from `initialize` are not
pushed to remote clients or exported. piwin never reads `~/.grok/auth.json`.

### 7. Version drift

The Host reads `agentVersion` on every process start and evaluates it against
a support matrix of probed versions. Unknown versions run with an "unverified"
status; protocol failures surface as explicit errors.

## Consequences

- Contracts gain backend identity, per-session capabilities, backend-provided
  option lists and backend permission options. Pi semantics are unchanged.
- The boundary checker lists `@piwin/acp-agent` as an application package.
- Pi-only features (conversation tree, cold storage, pause, compaction
  commands, Host subagents) are unavailable on Grok sessions by design.
- Grok's queue, `set_mode` confirmation gaps and missing interjection
  acknowledgement are accepted product limitations, not bugs to hide.
- Mock-transport fixtures cover determinism; a real-CLI smoke is still
  required before release.

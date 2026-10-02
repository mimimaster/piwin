# ADR 0082: Grok Build as a second session backend over ACP

| Field | Value |
|-------|-------|
| Status | **Accepted; implementation acceptance in progress** — local feature branch is not a published release; see the completion ledger |
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

### 8. Client behaviour

The Host is the authority; clients mirror it and never invent capability.

- **Draft picker.** A new session offers an agent choice only when the Host
  reports more than one agent. Pi stays the default and an agent that is not
  `ready` stays visible but unselectable, so the user learns it exists without
  starting a session that cannot run. In the Desktop workbench, clicking its
  setup label opens Agent Backends settings so the Host can be rechecked or
  configured. A Pi-only install keeps today's composer.
- **Per-session picker.** Pi's provider-backed model/thinking pill is replaced
  for an agent session by the agent's own `SessionBackendOptions` list. Pi model
  refs are never sent to another runtime, and `modeConfirmed: false` renders as
  pending rather than as the current mode.
- **Capability gating.** Unsupported operations are absent from the UI
  (compact, fork, duplicate, continue-in-project) or shown as the action that
  does exist (Stop instead of Pause). The composer toolbar always passes the
  abort handler to its action slot, including the normal layout used by Grok;
  Stop must invoke the Host cancellation path. Image attach stays visible and disabled,
  with the capability reason; paste and drop of a recognized image are refused
  with the same reason instead of painting a chip. The Host still rejects them:
  an image attachment on a Grok session fails `session/prompt` with
  `backend-operation-unsupported` rather than being silently dropped.
- **Slash menu.** A backend session lists the backend's own commands in a
  `Backend` group and hides Pi's product commands and Pi's modes, because the
  backend owns those tokens and receives them verbatim. A backend command that
  collides with a piwin item wins the token. For a Pi session the menu is
  unchanged.
- **Delete copy.** A Grok session's delete confirmation says the session is
  also removed from Grok: the backend owns its catalog, so a local-only
  expectation would be wrong.
- **Sidebar grouping.** Grok sessions enter the product index with
  `projectPath`/`scope` derived from their `cwd` (longest matching registered
  project root, `''` when unregistered), so the existing project and
  unregistered-worktree grouping already groups them by directory.
- **Readiness wording.** `unauthenticated` is never presented as usable, and an
  agent session row is labelled with the agent name while Pi stays unlabelled.
- **Separate adapter and dependency installation.** `piwin agents install`
  installs a reviewed declarative adapter through the Host inventory, without
  starting Grok. Official CLI dependency installation remains manual until a
  distribution recipe is verified. `enable`/`disable`/`uninstall` persist real
  Host-owned adapter state; uninstall preserves history and user-owned CLI.
  Directory reads do not probe CLIs. Check and first activation do. Session
  bindings pin the adapter revision; incompatible replacements require migration.

### 9. Outstanding

**Media bridge correction (2026-10-02).** The executable-extension route must attach the Host-imported media refs to its live and replay `tool/end` events, preserving the originating message id. Importing bytes alone is insufficient: Desktop's native media preview and the durable transcript consume event attachments. Source-file/content identity unifies live import and legacy backfill; old id-only receipts reuse the existing vault asset so repeated reads do not duplicate Library entries. See [the output integration plan](../plans/2026-10-01-grok-output-integration.md).

Implemented locally: Host backend routing and lifecycle, `@piwin/acp-agent`,
Desktop surfaces, CLI parity, capability gating, optional adapter inventory,
Agent marketplace distribution parsing and safe observed MCP status. These
are not a published release. Full acceptance is tracked in
[the completion ledger](../plans/2026-09-30-agent-plugin-completion.md).

Evidence and remaining boundaries:

- **Desktop Stop regression smoke (2026-10-01, grok 1.0.46).** A real
  Grok session in the isolated test project was cancelled by clicking the
  normal composer Stop button. The persisted assistant outcome is `cancelled`
  with `agentStopReason: aborted`; a subsequent prompt in the same session
  completed with `STOP_RECOVERY_OK`. A dock-level regression covers the full
  toolbar wiring. See [the verification record](../evidence/2026-10-01-grok-stop-button.md).
- **Generated media and workflow smoke (2026-10-01, grok 1.0.46).** The local
  `http://localhost:1420/` Desktop loaded the native `image_gen` output from
  the Grok session, imported it into the piwin media vault, rendered the
  existing image preview toolbar, and exposed the asset in the Library. The
  same session rendered the backend workflow card; progress expansion and
  report retrieval displayed the persisted `state.json` and `report.md`
  projection. Native media paths are accepted only from the validated Grok
  session output root and are deduplicated by an import receipt.
- **Real-CLI prompt smoke (2026-09-30, grok 1.0.44).** `detectGrokCli`
  reported `ready` / `cached_token` / `verified`. A throwaway `session/new`
  plus one text prompt returned `stopReason: end_turn` with usage meta
  (`inputTokens`, `outputTokens`, `reasoningTokens`, `cachedReadTokens`).
  Parsed models: grok-4.7 and grok-4.7-build-fast (efforts xhigh/high/medium/low,
  256k), grok-4.6 and grok-4.5 (4.5 has no xhigh; both 500k). Commands:
  compact, always-approve, context, session-info, deep-research, workflow,
  goal. The probe session was deleted.
- **Real tool update (same build).** A write of `probe.txt` in a temp directory
  arrived as `tool_call` (`title: write`, `rawInput` keys `file_path` and
  `content`) then `tool_call_update` (`kind: edit`, `content` type `diff`,
  `locations`, then `status: completed`). That matches the projector. No
  `session/request_permission` was sent: this machine's `~/.grok/config.toml`
  has `permission_mode = "always-approve"`. `session/set_mode` for `default`
  and `plan` returned `{}` and no `current_mode_update`, including across the
  following turn for `default`, so mode confirmation stays notification-based.
- **Cancel, rename, resume (same build).** `session/cancel` during a prompt
  returned `stopReason: cancelled`. Rename was visible to a following list.
  `session/resume` and `session/load` omit `sessionId` (they return `models`,
  `configOptions`, `_meta`); the client keeps the id it sent. A real resume
  then resolved to that same id.
- **Catalog list (same build).** `_x.ai/sessions/list` returned 19 sessions.
  Keys match the parser: `sessionId`, `title`, `cwd`, `isWorktree`, `modelId`,
  `reasoningEffort`, `yolo`, `activity`, `resident`, `lastChangeUnixMs`,
  `origin`. All 19 had a cwd; 16 had a string title; every `origin.kind` was
  `local` (none were subagents). `agents install` is still unprobed.
- **Agent plugin inventory.** `@piwin/agent-plugins` validates reviewed recipes
  and stores immutable adapter revisions. Host supplies atomic locked storage.
  Disabled/uninstalled adapters reject new Runs, including resident sessions
  and queued drain. Current Runs can finish; native history and authentication
  are untouched. Agent marketplace cards and independent `agents.json` are
  separate from extension `index.json` v1. Site publication is a separate gate.
- **MCP status.** Only observed `_x.ai/mcp/server_status` fields are projected;
  raw error reasons are replaced, never forwarded. No observed status is shown
  as unknown, not as an empty configured inventory.
- **Host capability enforcement is per-operation, not generic.** The Host
  rejects images on `session/prompt`; other unsupported operations are refused
  by their own command handlers, so a new backend must wire each one.

## Amendment: executable plugin contract (2026-10-01, in progress)

The product owner requires an installed Agent plugin to run its own reviewed
adapter, not a Host-built recipe. The contract for that change is now in
`@piwin/contracts`, and the Host installer downloads, digest-checks and
installs the reviewed artifact under `~/.piwin/agents/<id>/<revision>/`.
The process bridge and the Grok code move are subsequent steps and are not
claimed here.

- Schema 2 (`piwin-agent-stdio` v1) is the only executable declaration. It
  pins a source commit and one `node-esm` `agent.mjs` digest. It cannot name
  an install script, a package manager hook, or a second entrypoint.
- Schema 1 remains readable so an existing Grok installation can be offered
  an explicit migration. A v1 record has no artifact and cannot be launched;
  a registry source that pins a v1 declaration is rejected, never installed.
- Installation is download-then-record: the Host verifies the manifest digest,
  the pinned version, the artifact byte size and its SHA-256, writes the
  entrypoint and manifest into an immutable revision directory, and only then
  writes the inventory record. A failure removes the partial directory and
  leaves no usable state. Activation re-hashes the installed entrypoint, so
  tampering surfaces as `unavailable` instead of executing changed bytes.
- Compatibility authorizes an offer, never a silent revision switch. The Host
  updates only `pluginRevision` after confirmation and keeps
  `agentId`, `backendSessionId`, cwd, and history. An incompatible or
  unconfirmed binding is `migration-required`, never Pi.
- Plugin frames are a Host protocol. Vendor ACP/xAI fields stay inside the
  plugin. A decoded envelope does not make its method payload trusted.
- Generated-media messages may propose a relative file in a directory declared
  by the reviewed manifest. They cannot carry an absolute path, a vault id, or
  an import grant. Host import remains the only writer of piwin media.

### Amendment status: Host route replaced (2026-10-01)

The bridge and the code move landed. `host-runtime` no longer depends on
`@piwin/acp-agent` or `@piwin/agent-grok`: readiness and the adapter session are
served by `AgentPluginControlClient` / `AgentPluginSession` through the generic
`ExternalAgentBackend`. Pi-only commands were generalized into
`EXTERNAL_AGENT_UNSUPPORTED_COMMANDS` (no agent-id branch), capabilities are the
adapter's own `session/new` declaration, and media roots are resolved from the
reviewed manifest's `outputDirectories` — that schema was already frozen, so no
protocol change was needed. `pnpm test:bundle` now asserts the bundle carries no
vendor implementation, and the bundled adapter artifact ships in
`bundled-assets/agents/grok/` and installs with the same digest gate as a
download. A temporary Host plus the web shell verified install, revision
display, check, disable and uninstall through the same artifact. Evidence,
including what is still unverified (a paid prompt over the new path,
Windows/Linux):
[2026-10-01-grok-real-agent-plugin.md](../evidence/2026-10-01-grok-real-agent-plugin.md).

### Amendment: the backend is delivered as a piwin extension (2026-10-01, accepted; implementation in progress)

The product owner rejected the bundled delivery above. A backend that ships as
`bundled-assets/agents/<id>/` and installs into `~/.piwin/agents/` is not the
requested product: Grok Build must install through piwin's **existing extension
channel**, like every other extension.

1. The implementation lives in its **own source repository**, not in this
   monorepo, and not as a copy inside the registry repository.
2. `mimimaster/piwin-extensions` gains an ordinary entry pinned to an immutable
   40-character commit. The registry keeps storing metadata only; the code stays
   in the source repository (ADR 0077).
3. Install, enable, disable and uninstall go through the existing
   `@piwin/extensions` revision store. There is exactly **one** authority for
   whether the backend is available; a parallel `~/.piwin/agents/` inventory must
   not become a second switch.
4. The composer, command palette and Settings entry points are derived from the
   declared session backend of an **enabled** extension. Nothing is hardcoded:
   no Grok setup stub, no fixed Grok session command, no Grok-only shortcut. An
   uninstalled or disabled backend offers no entry point.
5. The official Grok CLI and its login stay user-owned and manual. Installing
   the adapter never means the CLI or the account is ready.

**Contract landed in this change.** An extension declares its backend in
`piwin.json` under a versioned `sessionBackend` block
(`parseExtensionSessionBackend`, schema 1, `packages/contracts`). The block
reuses the frozen `piwin-agent-stdio` frame protocol, capabilities, media
proposals, prompt outcomes and `outputDirectories` validation unchanged; only
the artifact location differs, because the adapter ships inside the same
immutable extension revision. It therefore names a safe relative `entrypoint`
plus `sha256`/`byteSize` instead of a download `url`. `pi` is a reserved
backend id. Unknown keys are rejected so a typo fails loudly rather than being
silently ignored. Parsing is pure: staging, listing and validation never import
or execute the artifact.

**Two gates still block a backend-only extension and belong to the next step.**
A staged extension directory is rejected unless it contains `index.ts`
(`inspectSource` in `@piwin/extensions`), and an extension whose entry source
cannot be read is classified `unverified` and dropped before it ever reaches a
Blueprint (`readExtensionCompatibility` in `@piwin/host-runtime`). A backend
revision has no Pi factory to classify, so both gates must become
manifest-aware without weakening validation for tool, hook and OAuth-provider
extensions.

**Enforcement is reversed by this decision.** The bundle must no longer carry a
Grok adapter at all, so the `test:bundle` assertion is inverted: it must fail if
`bundled-assets/agents/grok/` or any vendor implementation reappears in the
Host bundle. That reversal, the packaging removal, the Host-side wiring and the
registry validator are subsequent steps and are **not** claimed here.

Status: contract only. No source repository was created, no code was pushed, no
registry entry PR was opened, and no release was cut.

### Amendment: Simplified single-switch UI for Grok Build (2026-10-01, accepted)

The product owner directed that Settings → Agent Backends must offer a single, direct toggle switch for Grok Build rather than exposing internal adapter lifecycle controls, commit hashes, or separate manual installation states:
1. **Single toggle**: users simply turn Grok Build ON or OFF. Turning it ON ensures the adapter is initialized and immediately probes the Host environment for the official Grok CLI.
2. **Direct connection when detected**: if the Grok CLI is found and ready, it connects directly and displays version/path details without redundant steps.
3. **Clear error when missing**: if the CLI is not found in system PATH, the page directly renders an error notice: "本机未安装 Grok Build" (or "当前 Host 未安装 Grok Build"), with actionable guidance to install the official CLI and a "Check again" button.
4. **Clean layout**: git commit revisions and debug notices are removed from the main flow; advanced path overrides and read-only MCP status are neatly consolidated into an expandable "Advanced options" panel.

### Amendment: Automatic backend readiness after extension installation (2026-10-02, accepted)

Installing and enabling a session-backend extension must make it usable from
the workbench without a separate visit to Settings or a manual Check action.
The Host's ordinary `agents/status` query performs a bounded adapter check on
first use or cache expiry. Explicit refresh bypasses the existing 60-second
cache; disabled extensions are never launched. This supersedes the earlier
requirement that only explicit Check or session activation may probe readiness.
Extension staging and inventory listing remain data-only.

Desktop reacts to `marketplace/inventory-updated` for extensions as well as
legacy agents, refreshes readiness and re-reads enabled backend declarations.
Installing, enabling, disabling or uninstalling an extension therefore updates
the already-mounted composer and command palette. Older list responses cannot
overwrite a newer refresh. Missing CLI and unauthenticated statuses remain
unusable; readiness checking sends no model prompt and does not install or log
into the vendor CLI.

### Amendment: Prompt completion is a Run lifetime (2026-10-02, accepted)

The Host-to-plugin `session/prompt` response returns the terminal outcome of
the entire turn. It is not the immediate `session/prompt` acknowledgement
returned by the product Host to a shell. The generic 30-second bridge request
deadline therefore applies only to control and query requests. Prompt waits
remain pending through streaming, thinking, tool execution and approval waits
until the plugin returns an outcome or the process closes. Stop still uses the
bounded cancel request and the existing session cancellation grace/release
path. This matches the Pi worker's default completion lifetime.

The old deadline incorrectly failed an active Grok turn at 30 seconds even
while events were arriving. See
[the regression evidence](../evidence/2026-10-02-grok-prompt-timeout.md).

### Amendment: Host-observed backend turn timing (2026-10-02, accepted)

Backend usage that has no first-token measurement is enriched at the Host
plugin-session boundary. A monotonic clock measures prompt dispatch to the
first nonempty text/thinking delta, text snapshot or tool call. Message start
and empty deltas do not count. Observation happens before asynchronous media
imports and transcript projection. Replay and explicitly foreign Runs do not
receive live timing; each prompt resets the observer.

Grok's prompt usage is aggregate turn accounting. Host timing therefore uses
the same entire turn for `durationMs` and `firstTokenMs`, with
`timingScope: turn`. A vendor API duration is not mixed with Host-observed
TTFT. Adapters that already supply first-token timing retain their values.
The existing usage ledger, recent log and Desktop table consume these fields;
Desktop labels the rate as a turn average and explains that tools and approval
waits are included. TPS remains the reported completion tokens divided by the
turn duration minus first-token wait, using the shared plausibility fallback.
Missing token counts or first-content evidence are never invented. This turn
measurement remains a fallback for adapters without request accounting.

### Amendment: Recent calls include requests inside an active turn (2026-10-02, accepted)

One Grok prompt can contain many model requests. A single finalized turn row
must not be interpreted as a single request. An adapter may advertise
`requestUsage: true` in `plugin/initialize` and implement the optional
plugin-scope `catalog/usage` query. Older adapters are never sent an unknown
method; their finalized-turn view remains available.

The query returns normalized request ids, backend session ids, token counts,
duration and optional first-token timing since a requested instant. Host
queries only durable session bindings, validates these records and maps them
to product session ids. Vendor files and vendor token semantics belong to the
external adapter. Changing the selected extension refreshes the independent
control process while existing session processes continue running.

The Grok adapter reads `shell.turn.inference_done` accounting from the native
unified log and matches native `first_token` events when `ttft_ms` is absent.
Cached prompt tokens are split from uncached input. Reasoning is already in
completion tokens and is not added again. Context occupancy metadata is not
billable request accounting. Missing log files or timing stay unavailable;
file reads are bounded and arbitrary log context is never returned.

`usage/list-recent` reads these completed requests on every refresh, including
during an unfinished Run. Request details replace that session's aggregate
turn rows in this view so one call is shown once. The append-only billing
ledger and existing rollups are unchanged. Recent-window filtering,
deduplication and paging remain pure logic in the session package.

## Consequences

- Contracts gain backend identity, per-session capabilities, backend-provided
  option lists and backend permission options. Pi semantics are unchanged.
- The boundary checker lists `@piwin/acp-agent` as an application package.
- Pi-only features (conversation tree, cold storage, pause, compaction
  commands, Host subagents) are unavailable on Grok sessions by design.
- Grok's queue, `set_mode` confirmation gaps and missing interjection
  acknowledgement are accepted product limitations, not bugs to hide.
- Mock-transport fixtures cover determinism. grok 1.0.44 was probed for one
  text turn, one file write and a catalog list (see §9). A permission prompt
  was not observed because the local CLI is set to always-approve. Install is
  still unprobed.

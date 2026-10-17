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
  starting a session that cannot run. Grok remains selectable in the
  Conversations pane; a new Grok draft without an explicit project binding
  starts Loose instead of inheriting the open project. In the Desktop
  workbench, clicking its setup label opens Agent Backends settings so the
  Host can be rechecked or configured. A Pi-only install keeps today's composer.
- **New-session defaults (2026-10-03).** The draft model/effort/mode catalog
  comes only from the Host's current `ExternalAgentStatus.options`; cached
  options from any existing session are never a fallback. Entering or resetting
  an external draft queries that agent's status using the Host's bounded cache
  and in-flight check deduplication. Missing options stay in the model-loading
  state. Valid manual draft choices survive a catalog refresh; removed choices
  are discarded and the next conversation uses Agent defaults. First-send and
  explicit New Agent reset clear those choices. Existing sessions keep their
  own `SessionBackendOptions`. Detection publishes changes to readiness and
  configuration, even when the state remains `ready`, while ignoring a changed
  `checkedAt` alone. The control client owns change pushes; explicit refresh
  returns its status without publishing a second copy. Clients sync native
  sessions on first readiness/recovery, rather than on every model change;
  failed syncs remain retryable. No Grok model ids or context limits are inferred
  or hardcoded by the client.
- **Per-session picker.** Pi's provider-backed model/thinking pill is replaced
  for an agent session by the agent's own `SessionBackendOptions` list. Pi model
  refs are never sent to another runtime, and `modeConfirmed: false` renders as
  pending rather than as the current mode. A successful `session/backend-set`
  that omits live options has persisted the choice for the next resume; the
  client keeps that model/effort pick, and the requested mode once
  `modeConfirmed` settles, instead of replaying the pre-pick catalog. That
  settlement confirms only the session's latest options, and only while the
  requested mode id is still current, so a late empty success cannot restore an
  older model, effort, or mode, or recreate a session that is gone. Returned
  live options replace that cache exactly and remain authoritative. When a
  nonresident session has no live catalog, Desktop may hydrate choices from the
  matching ready agent's Host-declared catalog and validate the saved binding's
  choices against it; this does not confirm a runtime mode or invent capabilities.
  A later live catalog remains authoritative. Transcript composer projections
  track session/backend identity, backend options and draft engine selection;
  backend and engine handlers stay late-bound so a loading snapshot or old
  session callback cannot survive an identity/catalog update. Empty-stage engine
  cards use that same composer projection; choosing another engine on a bound
  empty session opens an unsent draft through the existing New Agent path,
  rather than changing the existing binding or only changing unrelated draft state.
  The composer resolves agent identity from the durable session binding (including retained
  rows after sidebar paging),
  independently of the optional backend catalog. Until that catalog arrives,
  it shows the agent name and a disabled model-loading state; it never presents
  the global Pi model selection for an externally bound session. Host publishes
  `session/backend-updated` after the first activation and every adapter option
  change, even if the client's earlier query found no catalog. External prompts
  omit Pi model/thinking fields, and a reply without a backend model snapshot
  retains the agent byline without inventing a model snapshot or inheriting the
  global Pi picker or a stale Pi turn. Remote session lists, paged lists, and
  index pushes carry the durable `backend.agentId` so the sidebar keeps its
  agent prefix after reload and renaming; native binding ids and adapter options
  remain on the Host. Named draft activation preserves an earlier creation
  push's binding and seeds the selected external agent immediately.
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
- **Sidebar grouping.** Newly discovered Grok catalog rows enter the product
  index with `projectPath`/`scope` derived from their `cwd` (longest matching
  registered project root, `''` when unregistered). Unmatched / default Grok
  sessions are Conversations (Loose), not No Repo and not the currently open
  project. Picking Grok on an empty stage while a project is merely open
  starts Loose; a project-folder `+` still creates a project-scoped Grok
  session under that repo. Catalog sync does not rehome an existing Loose
  Grok row into a project because cwd later matches. Desktop lists general
  Grok rows in the chat pane; only a project cwd snaps the sidebar to code.
- **CLI shell by default (2026-10-15).** Grok sessions and Grok drafts open
  in Grok's own TUI (the titlebar Desktop/CLI switch set to CLI) wherever
  Desktop can run it (`canOfferConversationCli`: native PTY plus a local or
  attached remote Host). Grok's TUI is the reference interface for "Grok
  follows Grok"; the Desktop ACP projection remains one click away and keeps
  its native-history replay on return. The default is decided once when a
  conversation is entered: choosing Desktop sticks for that conversation, a
  Grok session entered during a running Desktop turn stays on Desktop, and a
  CLI opened by the default is closed — without mounting a TUI — when the user
  moves on to a Pi or other agent conversation. Pi, Claude Code and Codex keep
  Desktop as their default. Clients without a terminal (Web, mobile, remote
  without an attach target) render the Desktop projection unchanged.
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
waits are included. TPS follows the shared rule (amended 2026-10-06): the
first-token wait is only deducted when it is known which tokens fell after it.
Host records `firstTokenKind` (`reasoning` when a thinking delta came first,
otherwise `content`) and, where the provider reports it, `reasoningTokens`.
Reasoning-first rates the whole output over duration minus first-token wait;
content-first with a reasoning count rates only the visible tokens over that
window; anything else divides completion tokens by the full duration, because
hidden reasoning otherwise inflates the rate by orders of magnitude.
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

### Amendment: Backend research belongs to its initiating transcript turn (2026-10-02)

Desktop polls workflow snapshots once per active session, independently of the
foreground prompt lifetime. Native `active` is an ongoing status. The main
transcript places each workflow inside the assistant article of its initiating
turn, using the start time and slash objective to distinguish repeated prompts.
If vendor replay replaces native message times with reconnect times, explicit
matching prompts are paired in transcript order; a later completion reminder
never steals the original research chain.
Later user turns do not move an earlier workflow to the transcript tail. A
workflow whose prompt is outside the loaded history retains a separate
assistant article until its owner is resident.

Research reuses `ToolBatchCapsule`, `ActionMarquee`, `InkLineNode`, local fold
measurement, and the existing Markdown report viewer. Running workflows show
stages and native worker status immediately; successful workflows fold and
failures remain expanded for inspection. An
explicit fold choice stays respected while running. Execution history is
secondary expandable detail. These are backend observations, not fabricated
Pi tool events, and no workflow state is written back by this UI. Pauses and
failures preserve completed stages and do not animate as running.


### Amendment: Native Grok Build view in Desktop (2026-10-11, accepted)

The titlebar Desktop/CLI switch opens Grok's own fullscreen TUI for a Grok
conversation, rather than piwin's terminal rendering of the ACP transcript.
The Host resolves the enabled extension's detected binary, trusted working
directory and durable `SessionBackendBinding.backendSessionId`, then launches
`grok --fullscreen --cwd <host-cwd> --resume <native-id>`. A new conversation
is created and bound through the existing Host session path first. General's
Pi-only scope stays intact: an unscoped native Grok conversation belongs to the
built-in No Repo workspace and Desktop adopts that scope without remounting.

`agents/cli-open` accepts only the Grok agent, an optional product session or
project locator and a bounded terminal grid. Remote locators must be opaque
project ids; resumed sessions use their saved Host cwd. The command needs a
caller gesture idempotency key so one click cannot spawn multiple terminals.
`pty/write`, `pty/resize` and `pty/close` carry only the returned terminal id
and bounded control payloads. The process package owns OS PTYs through
node-pty; host-runtime composes binary/trust/session policy and streams the
existing `pty/output` and `pty/exit` pushes. Desktop's shared xterm transport
buffers early output before the open response, just as the Tauri transport
does. The same protocol supports local sidecar and remote Host connections.
No executable path or arbitrary shell command is accepted from the renderer.

Returning to Desktop through the switch invokes `agents/cli-sync` in the background:
keep the interactive PTY alive, reload native history through the existing
`session/load` projection, and refresh Desktop even when already selected.
Concurrent refreshes share one operation. Runtime suspension uses the existing
residency transaction, which preserves protected Runs and serializes arriving
activation, rather than disposal that could cancel newly admitted work.
CLI selection stays available during replay; late completion cannot navigate
back after the user leaves or force a Desktop refresh while CLI is selected.
Rapid returns coalesce into a final snapshot. One native view is retained for
the current Host/session/scope, then released on navigation, terminal disable
or a Host-controlled Grok turn that makes its native snapshot stale.
Vendor-native interactive prompts remain owned by Grok; their recorded history
is imported through the existing adapter, rather than fabricated Pi events.

**Unreplayed history is announced on resume (2026-10-11).** `session/resume`
stays a durable read and never activates an adapter, so a session imported
from the agent's catalog, or continued in its own TUI, returned an empty or
stale transcript and clients painted it as a new conversation. The Host now
sets `SessionResumeData.nativeHistory = 'unsynced'` (projected to remote
clients) when the binding has a native id and its projection was never synced
or is older than the catalog's last change, unless a Host-controlled turn is
running. Desktop paints what the transcript has, requests `agents/cli-sync`
in the background (once per session and Host instance), and reloads the
session when the replay succeeds; a failed or timed-out replay is reported and
never blocks the transcript. While any selected session's transcript is
pending, Desktop shows the opening state, never the new-conversation landing.

Long histories need the adapter's streamed replay. The published adapter
(`b6e09c7`) returns the whole replay inline and a long session exceeds the
2 MiB frame limit; the producer side is implemented in the adapter repository
and verified on a development Host, but not yet committed or published. See
[the overflow evidence](../evidence/2026-10-05-grok-replay-frame-overflow.md).

**Generated images in the native view (2026-10-11).** Grok's TUI prints an
`[Open Image]` button that opens the file on the Host machine, which a remote
Desktop never sees, and it only draws inline images over the Kitty graphics
protocol, which the embedded xterm cannot render before xterm 6.1. Desktop
therefore takes the click itself: a capture-phase handler on the terminal
surface recognises the button and the file name printed above it, withholds
the click from the program, requests `agents/cli-sync`, and previews the
matching generated attachment from the session transcript. Only native agent
terminals opt in; the lookup is by base name within the newest transcript page.

The native addon stays external in Host packaging, including its executable
spawn helper. node-pty is pinned to `1.2.0-beta.12` because the stable `1.1.0`
macOS tarball ships that helper without execute permission (upstream #919).
The bundled ESM/pruned-dependency smoke exercises a real PTY after packaging.

### Amendment: Generic native CLI + bounded user-input contracts (staged, additive)

**Status: contracts only — not shipped Host runtime / Desktop UI.** This
subsection records the additive `@piwin/contracts` surface that later Host and
plugin steps implement. It does not claim launch, ownership handoff, input UI,
or Claude/Codex adapters are live.

1. **`agents/cli-open` agent id is a bounded external slug.**
   `AgentCliOpenInput.agentId` is a string validated by `isAgentPluginId` (Pi
   remains a distinct built-in route and is never a native-CLI agent id).
   The open payload is strict: no client-supplied `executable` / `argv` /
   `env` / `cwd`. Terminal `cols`/`rows` keep existing bounds. Syntactic
   validity is not Host install/trust/readiness. Existing `agents/cli-open`
   and `agents/cli-sync` command family is unchanged; Grok-shaped inputs stay
   accepted.

2. **Optional `nativeCli` capability.** `SessionBackendCapabilities.nativeCli`
   and ready/unauthenticated `ExternalAgentStatus.nativeCli` reuse
   `SessionBackendOperationSupport`. Absent means unsupported. Helpers treat
   absent as false; agent-level use also requires `state: 'ready'`. This is
   **not** added to `SESSION_BACKEND_OPERATIONS` (legacy full-Record fixtures).
   Pi must not implicitly claim native CLI; Pi's embedded TUI is separate.

3. **Optional plugin method `session/cli-launch`.** Params are
   `AgentPluginOpenInput` (cwd + binding with stored native id). Result is only
   `{ backendSessionId, args }` — never executable/cwd/env. The Host pairs the
   descriptor with the binary already verified via `initialize.runtime.binaryPath`
   and a trusted cwd. Pure decoder
   `parseAgentPluginCliLaunchResult` rejects unknown keys, empty/mismatched ids,
   control characters in argv, and oversize args; exact `args` must contain the
   native id as a separate element and may be checked against a trusted expected
   id. Call only when `hostCapabilities.nativeCliLaunch` was negotiated.
   Protocol version stays `1`; extension declaration schema is not bumped.

4. **Host-managed ownership contract types.** `AgentCliOwnership`
   (`desktop` | `native` | `switching`) and `AgentCliFailureCode`
   (`cli-unsupported` | `not-ready` | `session-unavailable` | `writer-busy` |
   `transition-failed`) describe one product-session writer handoff inside the
   Host, not an OS-wide CLI lease. `AgentCliOpenData` remains
   `{ ptyId, sessionId }` and may echo `ownership` metadata.

5. **Bounded native user input.** `backend-user-input` defines request/answer
   validators (title, ≤8 questions, text|select, unique ids, choice bounds,
   required defaults, cancelled XOR answers, 64 KiB aggregate). Plugin callback
   `input/request` carries `{ request, runId? }` → cancelled/answers. Call only
   when `hostCapabilities.nativeUserInput` is negotiated. Pending-request id and
   cancel stay on the outer plugin frame correlation; no duplicate run authority.

### Staged runtime (step 2): launch, history sync, single writer, input bridge

Host runtime now owns the lifecycle that the contracts above describe:

- **Ownership controller.** Per product session, Desktop vs native vs switching
  is reserved synchronously once the session id is known. Desktop
  normal/explicit/queued prompts early-reject and recheck with no awaits before
  `register`/`replaceForegroundRun`. Queue drain pauses before
  `pending→starting` while native owns the writer; a `writer-busy` admission is
  retryable without spin. `requestDrain` runs only after a successful Desktop
  return. Active Run handoff rejects; it is never cancelled as a hidden parallel
  actor. Remote client disconnect / `pty/close` hide the terminal only and
  **never** release write ownership (existing transport has no disconnect hook;
  this retain-across-reconnect behaviour is intentional and safe).

- **Generic launch.** `agents/cli-open` validates `isAgentCliOpenInput`, requires
  an enabled installed extension + ready agent + trusted cwd, creates/activates
  the product session for a stored native id, calls session-scoped
  `session/cli-launch`, parses with `parseAgentPluginCliLaunchResult(expectedId)`,
  and spawns only `ready.binaryPath` + trusted record cwd + validated argv.
  Structured idle runtime is suspended and disposed before PTY spawn. Grok's
  `buildGrokCliLaunch` remains a compatibility path **only** for old Grok
  adapters without the new method; no other backend and never Pi. Missing
  capability / disabled / unknown / error stay explicit. Spawning rollback unlocks
  Desktop only when no native actor was confirmed.

- **`agents/cli-sync` handoff.** Close the owned native PTY, await the real
  process exit (process package: SIGTERM → wait → SIGKILL → await `onExit`; if
  exit is unconfirmed the entry is retained and close throws), retire the
  structured observer, import history on the **exact** stored native id (never a
  “latest” reopen on failed load), then unlock Desktop and `requestDrain`.
  Failed load / unexpected exit leave `switching` until a successful sync.
  Close/dispose are idempotent; failure keeps the lock.

- **Minimal status wire.** `agents/cli-status` and push `agents/cli-ownership`
  expose Host-managed ownership only (no binary/env). Clients cannot set it.

- **Native human input bridge.** Host pending controller binds
  session/generation/Host `requestId`/active run + validated snapshot. Plugin
  frame correlation remains the bridge detail. Host command
  `session/backend-input-respond` and pushes `session/backend-input-request` /
  `session/backend-input-settled` carry typed result + scope. The bridge answers
  `input/request` only when a real handler is wired and `nativeUserInput` was
  advertised; answers wait for respond/lifecycle cancel (not the generic 5s
  callback timer). Stale/foreign generation/run answers never reach a new
  generation. Cancel-once on run cancel, release, generation replacement,
  process close, and Host dispose. Native permission approvals remain native
  pending permissions, not Host remembered rules.

Later steps own Desktop/CLI UI mapping and independent local Claude/Codex
plugins. Plugin repositories remain external. No vendor real-binary or native
UI verification is claimed by this Host stage alone.

### Amendment: Native view changes preserve the active actor (2026-10-12)

The product owner reported that changing sessions or returning to Desktop
interrupts an active Grok turn. View navigation must preserve the actor and
must not imply a writer handoff. For an owned native PTY, `pty/close` detaches
the view; re-open reuses the same PTY with bounded replay returned only to the
attaching client. Host disposal still terminates its processes.

`agents/cli-sync` accepts optional `preserveNative`. Desktop view, native
history and image refresh use it. With an attached actor this reads an adapter
snapshot without `session/load` or runtime activation, keeps native ownership,
and never drains the Desktop queue. An explicit handoff retains the existing
close/import/unlock ordering. A Desktop prompt may hand off only after a fresh
native observation reports idle; running and human-waiting actors remain
protected by the writer gate.

The plugin-scope optional `catalog/native-observe` capability is negotiated by
`nativeObservation: true` in initialization. It returns the exact requested
native id, normalized unknown/idle/running/waiting activity, optional title and
change time, and optionally bounded replay emissions. Older plugins never
receive the unknown method. Vendor file parsing remains inside the external
adapter. Grok uses its session telemetry and existing replay projector, since
ACP catalog activity reflects the querying process and can report dormant
while a different native actor is running. Host imports media proposals using
the same reviewed directory and vault rules as ordinary replay.

Host observes only its attached native bindings for activity and index
metadata, uses the existing index/ownership pushes, and stops observations at
actor exit or handoff. No missing entry reconciles/deletes a running binding.
Desktop preserves these transient observations across list hydration and uses
them for activity indicators and ordering. Native process presence alone is
never interpreted as an active turn. See the [repair plan](../plans/2026-10-12-grok-native-session-continuity.md).

Desktop sends the distinct `agents/cli-snapshot` command for view/history/image
reads. It routes to the preserved-writer snapshot path above. A legacy Host
rejects this unknown command rather than interpreting a new optional flag on
its old handoff request and silently terminating the turn. The existing
`agents/cli-sync` and its optional preservation flag remain compatible for
other callers; the UI does not use its ambiguous legacy default.

### Amendment: Agent sessions stay on their agent (2026-10-14, accepted)

A Grok session mid-turn showed an approval card. Five seconds later the turn
failed with "Pi prompt aborted without a Host abort reason". The next turn,
including Continue, then ran on a fresh Pi runtime with no context. Three
Host defects caused this:

1. **Approval waits are human waits.** The bridge put `permission/request`
   behind the same 5-second bound as machine callbacks. When the timer expired
   it answered `cancelled`, the agent dropped the whole turn, and the card
   stayed open. Permission callbacks now wait like `input/request`: for
   `permission/resolve`, Stop or supersede (`settlePendingPermissionsForSession`),
   or the agent process closing, which now settles that session's open cards.
   `intervention/event` keeps the bound.
2. **Pi Settings never replace an agent runtime.** An agent generation is
   attached with `EXTERNAL_AGENT_SETTINGS_REVISION`. A runtime-affecting
   Settings save (MCP, Web, …) used to queue a Pi `after-current-run`
   replacement for every live session. When the agent turn ended, that
   replacement compiled a Pi candidate in place of the agent. Now
   `recordSettingsChange` ignores agent generations, `planReload` refuses them
   (`external-agent`), `applySettingsRuntimeImpact` skips them, and
   `compileRuntimeCandidate` throws for an external binding as a backstop. The
   agent owns its own configuration (§1).
3. **Continue is a continuation prompt.** A `source: 'continuation'` turn sends
   the Host continuation instruction to the agent. Like the Pi path, it writes
   no empty user row.

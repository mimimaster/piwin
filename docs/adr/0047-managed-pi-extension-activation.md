# ADR 0047: Host-managed Pi Extension revisions and Runtime activation

| Field | Value |
|-------|-------|
| Status | Proposed |
| Date | 2026-08-12 |
| Extends | [ADR 0010](./0010-pi-extensions-channel.md) |
| Related | [Runtime Refactor](../specs/runtime-refactor.md)、[Settings / Capability Runtime Refactor](../specs/settings-capability-runtime-refactor.md)、[ADR 0012](./0012-rpc-worker-isolation.md)、[ADR 0036](./0036-host-server-multi-client-deployment.md)、[ADR 0040](./0040-host-session-runtime-residency.md) |
| Product spec | [Pi Extension 产品化方案](../specs/pi-extension-productization.md) |

## Context

ADR 0010 established a safe package boundary for Pi Extensions: product-owned
paths live under `~/.piwin/extensions`, Host Runtime compiles exact paths, and
only `@piwin/agent-host` imports Pi and executes extensions. The implemented
slice supports local/Git install, discovery, enable/disable, Desktop listing,
and the same resource paths in SDK and worker modes.

That slice is not yet a product lifecycle:

- install overwrites mutable paths and has no version, integrity, rollback, or
  last-known-good record;
- the current summary contract conflates configured enablement with what a live
  Runtime has loaded;
- direct `extensions/set_enabled` persistence bypasses revisioned Settings
  application and live-session staleness;
- resource catalog hashing includes paths and metadata, but not extension file
  content, so a same-path edit can escape snapshot revisioning;
- Pi supports native `ctx.reload()`, but a same-session resource reload would
  bypass piwin's Host-owned runtime generation, immutable Blueprint,
  multi-client state, and SDK/worker conformance boundaries;
- extensions are arbitrary Host-user code. The permission rule engine is not a
  sandbox, and the worker process is only a crash/teardown boundary;
- Desktop bridges basic dialogs but does not implement Pi's full TUI extension
  surface.

piwin already has the correct product primitive for changing a live Agent:
`SessionRuntimeReplacementEngine`. The missing decision is how an extension
revision reaches that engine and how install, desired state, effective state,
and per-session loaded state relate.

## Decision

### 1. Product promise is current-session capability replacement

The product capability is named **Live Extensions / 即时扩展**. A user may
install a trusted Pi Extension and apply it to the same product session without
restarting the piwin app or creating another conversation.

The implementation replaces the session's Agent Runtime generation at a Run
boundary. It is not an in-place, lossless JavaScript hot patch. Product history
and session identity remain stable; Pi-internal transient context may be
reconstructed from bounded product history.

### 2. Install is inert; execution requires explicit user activation

Acquiring, inspecting, hashing, and storing third-party source must not import
or execute its entrypoint. A newly installed third-party revision is stored as
an immutable inactive revision and is disabled by default.

Before the first candidate execution, an authorized user must accept that the
extension runs with the Host user's OS privileges. An Agent, Skill, extension,
remote unprivileged client, or model-callable tool cannot grant that approval.

### 3. Managed revisions are immutable and exact

Add a focused `@piwin/extensions` application package. It owns manifest
normalization, immutable content revisions, registry persistence, provenance,
static validation, quarantine, and garbage collection. It imports contracts
but never Pi.

Managed revisions live below `~/.piwin/extensions/revisions/<id>/<revision>/`.
Every Blueprint pins an exact extension id, content revision, and entry path.
Updating an extension creates a new directory; it never overwrites a directory
referenced by a live generation.

Existing flat files/directories remain supported as `legacy-unmanaged` during
migration, with degraded reproducibility and rollback status.

`@piwin/marketplace` acquires local, Git, and future package sources. It does
not own registry state, activation, or Runtime creation.

### 4. Extension content participates in capability identity

Contracts gain an extension revision reference and extension-set revision.
`ResourceCatalogEntry` / `ResourceInstance` may carry `contentRevision`, and
`CapabilityInputRevisions` carries `extensionSetRevision` computed from the
sorted exact active extension set.

The generic resource catalog revision must also include resource content
revisions when present. A same-path extension content change therefore changes
the capability snapshot and cannot remain hidden behind the old path hash.

### 5. Host Runtime owns one deployment transaction

`@piwin/host-runtime` composes one `ExtensionDeploymentCoordinator` from:

- `@piwin/extensions` registry/revision services;
- `SettingsService`;
- Blueprint compilation;
- `SessionRuntimeReplacementEngine`;
- runtime admission and audit services.

Extension mutations use Settings and registry compare-and-swap revisions.
Legacy `extensions/set_enabled` becomes a compatibility facade over that path;
it must not continue writing `config.json` independently.

Each deployment has a durable/idempotent id and phases that distinguish
validation, waiting for a Run, candidate creation, publication, failure,
rollback, and restart-required cleanup. Deployment progress is a sibling
`HostPush`, not a synthetic Pi `AgentEvent`.

### 6. No Runtime changes in the middle of a Run

The default activation policy is `after-current-run`. An idle session may
replace immediately. `now` is valid only when idle; “Stop and apply” first
cancels the current Run through the normal Host control path.

After a user requests a disable or quarantine, the affected stale generation
does not admit another Run before replacement. A normal disable lets the
current Run finish. Quarantine may explicitly cancel it.

Cold sessions do not need proactive replacement. Their next activation uses
the latest committed last-known-good extension set.

### 7. Candidate failure retains the published generation

A candidate is compiled and created before it becomes the active generation.
Failure before publication keeps the old generation and extension set
available. The failed revision does not become last-known-good and is exposed
as `failed-using-previous`.

Rollback of registry/runtime publication does not roll back arbitrary external
side effects produced while executing candidate code. The UI and audit record
must say so.

Old generation disposal happens after publication. A cleanup failure is a
degraded/restart-required condition; it must not be reported as if the old code
were certainly unloaded.

### 8. Worker isolation and SDK cleanup are reported differently

The piwin-owned worker can terminate the worker that hosts the old Runtime and
best-effort clean its process tree, so it is the stronger cleanup/crash
boundary. It cannot prove that deliberately detached descendants or external
side effects are gone. It is not an OS sandbox: extension code still has the
Host user's filesystem, process, network, and secret access.

In SDK mode, shutdown and generation drop cannot prove that module-global
timers, spawned processes, mutated singletons, or cached imports are gone.
Immutable revision paths ensure new code can be loaded, but a failed or
misbehaving extension may require Host restart. Runtime status and UI expose
`restart-required` instead of claiming full unload.

### 9. Compatibility is explicit, not inferred from “Pi Extension”

The catalog records static and observed compatibility separately. Initial
supported surface is Agent tools/events and the existing basic dialog bridge.
TUI custom components, widgets, editor/keybinding/theme integrations, native
reload-dependent flows, and unpinned external resource discovery are degraded
or incompatible unless a later adapter implements them.

Tool-name conflicts fail candidate publication by default. Pi built-in override
is an explicit advanced risk. Dynamic tool registration remains behavior of the
pinned extension revision and is projected as an observed runtime surface, not
as a new install revision.

Compatibility inspection is a reliability aid, not a security scanner.

### 10. Pi native `ctx.reload()` is not the managed activation path

Managed piwin sessions do not use Pi's native same-session reload as the
primary extension update mechanism. It does not preserve Host generation and
Blueprint authority, and its synchronous command semantics cannot safely wait
for the same Run to terminate.

In managed mode, an attempted `ctx.reload()` must fail with a stable,
actionable `managed-runtime-reload-required` error rather than silently doing
nothing or changing resources behind the Host. Users and development watchers
request Host-managed activation.

A future linked-development optimization may use a Pi-native reload only after
an ADR proves runtime identity, content revisioning, Host visibility, and SDK /
worker conformance. Full Runtime Replacement remains the fallback.

### 11. Agent-authored extensions stop at a draft boundary

The Host may expose a model-callable draft service and a bundled authoring
Skill. Drafts are outside the active registry. The model can create files and
submit a review request, but only an authorized user can trust, install, enable,
update, or activate the revision.

The Run that authored the extension finishes against its original capability
set. The new capability becomes available on a later Run after replacement.

### 12. Host remains the multi-client authority

All clients observe the same registry, deployment and runtime binding. Commands
are idempotent and CAS-protected. Remote extension install remains denied by
default, and remote activation gains a separate default-deny policy because it
causes Host code execution.

Client paths are never interpreted as Host paths. Gateway processes only relay
contracts and never inspect, store, approve, or execute extension code.

## Consequences

### Positive

- piwin can truthfully offer “apply new Agent capability without restarting the
  app or creating a conversation.”
- immutable revisions make exact rollback, audit, multi-session coexistence,
  and candidate failure recovery possible;
- Runtime Replacement reuses existing Host authority instead of adding a
  second Pi lifecycle;
- configured/effective/loaded state becomes understandable in Desktop, CLI,
  and remote clients;
- SDK and worker consume the same revision-pinned Blueprint;
- the model may help author extensions without gaining self-approval.

### Negative

- activation is heavier than Pi's direct in-session reload because it creates a
  new Agent Runtime generation;
- visible conversation continuity does not imply lossless Pi-internal state;
- arbitrary extension code remains fully privileged and can produce
  non-rollbackable external side effects;
- SDK mode cannot guarantee cleanup without a Host restart;
- full Pi TUI extension compatibility is not available in Desktop;
- revision storage, dependency materialization, GC, deployment journaling, and
  compatibility diagnostics add meaningful product complexity.

## Rejected alternatives

1. **Call `AgentSession.reload()` / `ctx.reload()` after every file change.**
   This bypasses Host runtime generation, snapshot, CAS, residency and
   multi-client authority, and has different cleanup guarantees by backend.
2. **Overwrite `~/.piwin/extensions/<name>` in place and restart sessions.**
   Old generations no longer have a reproducible path and rollback is unsafe.
3. **Install and auto-enable in one click.** Static inspection cannot establish
   trust; source acquisition must not silently become code execution.
4. **Treat worker execution as a sandbox.** It limits crash and teardown scope,
   not OS access.
5. **Put lifecycle ownership in `@piwin/agent-host`.** That would make the Pi
   adapter own product registry, Settings, sessions and deployment policy,
   violating the composition boundary.
6. **Keep lifecycle in `@piwin/marketplace`.** Marketplace owns acquisition,
   not Runtime authority or durable session state.
7. **Let Agent-generated code self-activate.** A prompt instruction is not a
   security boundary and enables silent self-modification.
8. **Promise compatibility with all Pi extensions.** Pi TUI and native command
   surfaces exceed the current Desktop/Host bridge; silent no-ops are worse than
   an explicit compatibility tier.

## Acceptance gate

This ADR may move to Accepted when the product owner agrees to these locked
points:

1. “hot update” means Host-managed Runtime generation replacement at a Run
   boundary, not in-place module patching;
2. third-party install is inert and first execution requires user approval;
3. extension code is documented as full Host-user privilege;
4. immutable revisions and exact Blueprint paths are mandatory;
5. candidate failure keeps the old generation and last-known-good version;
6. SDK cleanup may require Host restart;
7. native `ctx.reload()` is not the v1 managed path;
8. Agent-authored extensions require a human approval boundary;
9. a new `@piwin/extensions` package owns non-Pi lifecycle state;
10. remote activation is default-deny and Host-owned.

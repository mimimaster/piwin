# Settings-to-Runtime Hot Apply Repair Plan

Status: Implemented and regression-tested
Date: 2026-08-12
Owners: contracts, host-runtime, agent-host adapters, Desktop, CLI

## 1. Outcome

Saving Settings must never require restarting the Desktop app or Host for a
`new-runtime` change such as Web search configuration.

The Host owns a latest-wins runtime update transaction:

- the currently executing Run tree may finish on its immutable runtime
  generation;
- a genuine capability revocation takes effect for subsequent tool admissions
  immediately;
- the next root Run cannot enter the stale generation;
- when the old generation has no active Runs, the Host automatically activates
  the newest committed settings revision;
- cold sessions simply activate from the newest revision on their next Run;
- replacement failure preserves the old runtime for rollback, but does not
  silently admit new Runs against stale configuration.

For the reported Web search case, changing `delegate -> cli` is a schema change,
not a security tightening. The current Run may keep using its old delegated
search implementation; the next Run must use CLI search without an application
restart and without a false `web settings tightened` error.

## 2. Confirmed defects

### 2.1 Domain-level classification is too coarse

`SettingsService.classifySettingsImpact()` currently treats every mutation in
an "immediate tightening domain" as an immediate tightening. Consequently, a
Web timeout edit, a result-limit edit, or a source switch can disable all Web
tools even when capability was not revoked.

`ImmediateSafetyGate` then blocks the whole Web family from only the stale
domain marker. This loses both the direction and meaning of the settings delta.

### 2.2 One revision field has two incompatible meanings

`expectedSettingsRevision` is currently used as both:

1. the revision used by the active generation; and
2. the revision from which the replacement candidate must be compiled.

Those are different during every real update. If the active generation is on
`r1` and Settings commits `r2`:

- passing `r1` satisfies the current reload precondition, but candidate
  compilation sees `r2` and fails its revision check;
- passing `r2` can compile the correct candidate, but the reload precondition
  rejects it because the active runtime is still on `r1`.

Unit tests currently mock compilation with the requested revision, so they do
not exercise this end-to-end contradiction.

### 2.3 Settings persistence does not schedule replacement

`settings/apply` records stale domains for resident sessions but does not submit
a replacement request. Desktop can display stale state, but it has no automatic
apply path and no complete reload action wiring. A runtime can therefore remain
stale indefinitely.

### 2.4 Replacement requests do not coalesce

Pending replacement state is keyed by one expected revision. A second save can
conflict with the first instead of superseding it. This is incompatible with
normal Settings behavior, where several saves can occur while one Run is still
finishing.

## 3. Product semantics

### 3.1 Apply timing

| Change class | Existing Run tree | Next root Run | App/Host restart |
|---|---|---|---|
| `immediate` | Use live value | Use live value | No |
| `new-runtime`, no revocation | Finish on frozen generation | Wait for and use newest generation | No |
| `new-runtime`, capability tightened | Finish, but newly admitted revoked operations fail | Use newest generation | No |
| `host-restart` | Unchanged | Unchanged until restart | Yes, explicitly reported |

"Immediate" applies at a safe admission boundary. It does not retroactively
kill an already executing process or network request unless the user chooses
Stop or an explicit security-incident policy requires termination.

### 3.2 Definition of current turn completion

The user-visible current turn is complete only when its root `session-turn` Run
and every descendant Run are terminal. Terminal statuses are:

- `completed`
- `failed`
- `cancelled`
- `interrupted`

`queued`, `running`, and `cancelling` are active. A final assistant text event,
a tool result, a cancellation request, or the disappearance of a spinner is not
sufficient.

Runtime replacement uses a stricter safe-swap predicate: there must be no
active Run bound to the old generation, including generation-bound work outside
the foreground root. Pending permission/UI ownership and run-scoped cleanup
must resolve before terminalization. The coordinator reacts to authoritative
Run lifecycle events; it must not infer completion from transcript events or
poll UI state.

### 3.3 New prompt while an update is pending

Do not bind a newly accepted root Run to the stale generation. Create it as a
queued, generation-unbound Run, complete activation of the desired generation,
attach the generation exactly once, and then start it. Existing descendants of
the already running root remain admissible so the current turn can finish.

This requires a generation-level root-admission barrier. Closing the existing
root Run's descendant admission would be incorrect because it could prevent the
model from completing already-authorized subagent or tool work.

## 4. Contract repair

### 4.1 Separate active and desired revisions

Replace the overloaded revision semantics with explicit state:

```ts
type RuntimeUpdateIntent = {
  targetSettingsRevision: string;
  affectedDomains: readonly SettingsDomain[];
  immediateRestrictions: readonly ImmediateCapabilityRestriction[];
  requestedAt: string;
};

type SessionRuntimeUpdateState = {
  activeGenerationId?: string;
  activeSettingsRevision?: string;
  desiredSettingsRevision?: string;
  state:
    | "current"
    | "waiting-for-runs"
    | "preparing"
    | "swapping"
    | "failed"
    | "restart-required";
  affectedDomains: readonly SettingsDomain[];
  activeRunIds: readonly string[];
  failure?: HostErrorShape;
};
```

The active generation identity is the compare-and-swap token. The target
settings revision identifies immutable candidate input. A client action may
carry `expectedActiveGenerationId` or `expectedDesiredRevision` to reject stale
UI actions, but the client must not choose the runtime's target revision.

Deprecate `SessionReloadRuntimeCommand.expectedSettingsRevision`. Normal updates
are internal Host scheduling, not a client-orchestrated reload command.

### 4.2 Preserve immutable candidate input

Candidate compilation must not re-read a moving Settings file and pretend it is
the requested revision. `settings/apply` already has the committed normalized
snapshot. Retain that immutable snapshot (or an equivalent runtime blueprint
input) in Host memory while resident generations converge.

If the Host process restarts, all live generations and pending intents disappear
together; the next activation compiles from the durable latest Settings
revision, so no pending-intent persistence is required.

### 4.3 Report semantic impact

Replace the domain-only `securityTightenedImmediately` decision with a pure,
direction-aware impact result:

```ts
type SettingsMutationImpact = {
  domain: SettingsDomain;
  timing: SettingsApplyTiming;
  runtimeSchemaChanged: boolean;
  immediateRestrictions: readonly ImmediateCapabilityRestriction[];
};
```

The boolean may remain temporarily as a derived compatibility field
(`immediateRestrictions.length > 0`), but it must not drive policy by itself.

Each active generation should retain a small effective capability manifest.
Host-runtime derives the desired manifest from the newest normalized Settings
plus session/project context. A pure diff between active and desired manifests
produces exact restrictions. This avoids overblocking when a session is already
more than one settings revision behind.

Minimum classifier cases:

- Web `delegate -> cli`: runtime schema changed, no immediate restriction.
- Web timeout/result-limit change: runtime schema changed, no immediate
  restriction.
- Web search enabled -> unavailable/disabled: restrict Web search admissions.
- Provider/profile/credential explicitly removed: restrict only operations
  requiring the removed capability.
- Process enabled -> disabled: restrict new process admissions.
- Notes/flashcards write access removed: restrict writes, not unrelated reads.
- Permission policy tightened: evaluate not-yet-started tools against the newest
  policy; loosening becomes effective with the new generation.
- Subagent profile removed: reject delegation to that profile, not all tools.

`readOnly` is not a substitute for this classification. For example, Web search
is data-read-only but still exercises network capability.

## 5. Host-owned latest-wins coordinator

Introduce one coordinator in `@piwin/host-runtime`; do not place this policy in
Desktop or `@piwin/agent-host`.

### 5.1 Save path

For a successful `settings/apply` from `r1` to `r2`:

1. Persist and publish `r2`.
2. Build semantic impacts and desired capability manifests.
3. Apply exact live restrictions to future tool admissions.
4. For every resident affected session, set desired revision to `r2` and
   schedule convergence.
5. Cold sessions need no work; their next activation already targets `r2`.

Only domains with `new-runtime` timing enter this coordinator. A
`host-restart` impact remains explicit and must never be mislabeled as hot
applied.

### 5.2 Runtime state machine

```text
live/current
    -> waiting-for-runs     old generation has active Runs
    -> preparing            candidate uses exact desired revision
    -> swapping             generation CAS and admission handoff
    -> live/current         old generation disposed after handoff

preparing/swapping
    -> failed               old generation retained, new roots stay barred
failed
    -> preparing            automatic retry on next prompt or explicit Retry
```

If the generation is idle at save time, skip `waiting-for-runs`. Resident idle
generations may be replaced immediately with bounded concurrency. Cold sessions
must not be eagerly materialized merely because global Settings changed.

### 5.3 Replacement transaction

For target revision `rN`:

1. Capture `(oldGenerationId, targetRevision)`.
2. Keep current Run trees on the old immutable generation; bar only new root
   Runs from binding to it.
3. Wait until every old-generation Run is terminal.
4. Re-read desired state. If the target changed, abandon the obsolete candidate
   and restart from the newest target.
5. Prepare a candidate blueprint and backend from the immutable target input.
   Its tool surface remains non-admitting before commit.
6. Re-check both desired revision and active generation identity.
7. Atomically publish the candidate generation and transfer root admission.
8. Clear only stale domains/restrictions covered by the committed revision.
9. Dispose the old generation and ignore its late events by generation ID.

The architecture/ADR wording should explicitly adopt this blue/green handoff:
the candidate may be prepared while the old backend exists, but at most one
generation admits new root Runs or tool work. Candidate failure never replaces
the active generation.

### 5.4 Consecutive saves

Desired revision is latest-wins:

- `r2` followed by `r3` while Runs drain becomes one replacement to `r3`.
- `r3` arriving during `r2` preparation cancels/discards the `r2` candidate
  before commit and prepares `r3`.
- if `r2` already committed, `r3` schedules one subsequent convergence.
- normal supersession is not a revision-conflict error.

Affected domains and immediate restrictions must be recomputed from the active
generation's manifest to the latest desired manifest. Blindly unioning prior
restrictions would keep a capability blocked after a later save re-enables it.

### 5.5 Failure behavior

On candidate compile/start/swap failure:

- retain the old generation until safe disposal;
- keep genuine immediate restrictions active;
- keep new root admission barred from the stale generation;
- publish structured state with stage, target revision, and retryability;
- retry on the next prompt and expose an explicit Retry action;
- never degrade into repeated model-visible `Tool disabled: settings tightened`
  failures for a non-tightening change.

An explicit **Stop current turn and apply now** action may cancel/join active Run
trees before replacement. It is recovery/acceleration, not the normal save
path.

## 6. UI and CLI behavior

Normal Settings save is automatic. Do not ask users to understand generations
or manually restart.

Desktop status copy should distinguish:

- `Saved and applied.`
- `Saved. The current turn will finish with its existing runtime; the update is queued.`
- `Updating runtime... New prompts will wait.`
- `Runtime update failed. Retry, or stop the current turn and apply now.`
- `Saved. This particular setting requires a Host restart.`

The session runtime view should expose active/desired revision, state, affected
domains, active Runs preventing handoff, and a precise failure. Normal state
needs no Apply button. Failure or a long-running turn may expose **Retry** and
**Stop and apply now**.

Desktop and CLI must call the same Host commands. Recommended recovery commands:

- `session/runtime-update-status`
- `session/retry-runtime-update`
- `session/stop-and-apply-runtime-update`

Existing `session/runtime-status` may be extended instead of adding a second
status command. Migrate or remove the ambiguous manual reload command rather
than keeping two competing authorities.

## 7. Implementation slices

### Slice A — contracts and semantic impact

Touch:

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/session-runtime.ts`
- `packages/contracts/src/host-command.ts`
- new focused classifier/manifest files in
  `packages/host-runtime/src/settings/`

Deliver:

- explicit active/desired revision fields;
- semantic restriction types;
- pure delta/manifest tests;
- temporary compatibility parsing only if an existing client requires it.

### Slice B — fix generation authority and replacement transaction

Touch:

- `packages/host-runtime/src/sessions/session-runtime-controller.ts`
- `packages/host-runtime/src/session-runtime-replacement.ts`
- `packages/host-runtime/src/host-command-runtime.ts`
- relevant colocated tests

Deliver:

- generation-ID CAS;
- immutable target snapshot input;
- latest-wins candidate supersession;
- root-admission barrier;
- event-driven drain based on RunRegistry terminalization;
- rollback and retry behavior.

### Slice C — precise immediate admission

Touch:

- `packages/host-runtime/src/sessions/immediate-safety-gate.ts`
- permission/tool admission wiring in `host-runtime`
- application-service metadata only where needed

Deliver:

- remove domain-wide false blocking;
- exact capability/policy re-evaluation for not-yet-started operations;
- structured, user-meaningful disabled reasons.

Do not move Pi-native tool schema logic into application packages. Pi event/tool
adaptation remains inside `@piwin/agent-host`; product admission policy remains
inside `@piwin/host-runtime` and injected ports.

### Slice D — automatic scheduling

Touch:

- `packages/host-runtime/src/host-runtime.ts`
- a focused runtime-update coordinator module
- Run lifecycle subscription/integration points

Deliver:

- settings save -> converge all resident affected sessions;
- cold-session no-op;
- queued unbound root Run -> latest generation activation;
- bounded replacement concurrency;
- status pushes for every transition.

### Slice E — Desktop and CLI parity

Touch:

- Desktop settings request adapters/context
- session runtime page and save notices
- CLI session/runtime commands

Deliver:

- automatic-state UX;
- Retry and Stop/apply recovery actions;
- remove "new sessions only" wording for hot-applicable domains.

### Slice F — governing docs

Before merge, update:

- `docs/specs/settings-capability-runtime-refactor.md`
- `docs/specs/runtime-refactor.md`
- `docs/architecture.md`
- ADR 0040 or a new runtime hot-apply ADR
- `docs/dev-plan.md`

This intentionally supersedes the earlier manual-only pending-changes UX in
SCR-06. Manual controls remain escape hatches; Host-owned automatic convergence
is the default.

No new package or dependency is required.

## 8. Required verification

### 8.1 Unit tests

- every semantic classifier case in section 4.3;
- active `r1` + desired `r2` compiles exact `r2` without revision conflict;
- `r3` supersedes pending/preparing `r2`;
- a later re-enable removes an earlier immediate restriction;
- terminal root with active child does not trigger replacement;
- `cancelling` remains active until authoritative terminalization;
- late old-generation events are dropped after swap;
- compile/start failure preserves old generation and update intent;
- retry commits the desired revision and clears only covered stale state.

### 8.2 Integration tests

- busy SDK generation drains, swaps, and the next Run binds to the new
  generation;
- equivalent RPC behavior;
- new prompt during drain is queued unbound and never enters the old generation;
- pending permission/subagent/tool Run delays safe swap;
- cold session activates directly on newest Settings;
- multiple resident sessions converge without eagerly creating cold sessions;
- genuine revocation blocks only the revoked admission during an active turn.

### 8.3 Regression scenario for this incident

1. Start a session on revision `r1` with delegated Web search.
2. While its root Run is active, save revision `r2` selecting CLI search.
3. Assert the current Run is not domain-wide blocked as "Web tightened".
4. Let the root and all descendants terminalize.
5. Assert automatic replacement reaches `r2` without app/Host restart.
6. Send the next prompt and assert its `web_search` uses CLI search.
7. Assert no stale revision conflict and no manual rebuild action was required.

### 8.4 Repository gates

- `pnpm typecheck`
- tests for every touched package
- Desktop manual smoke for save/status/retry/stop-and-apply copy
- public exports reviewed intentionally

## 9. Acceptance criteria

The repair is complete only when all of the following hold:

1. A Web source switch never requires an app restart.
2. A source/timeout/result-limit change does not masquerade as a security
   tightening.
3. The current Run tree has one immutable generation; the next root Run cannot
   enter a known-stale generation.
4. Runtime convergence starts automatically after Settings save.
5. Active and desired revisions are represented separately throughout the
   contracts and implementation.
6. Repeated saves coalesce to the latest revision without normal conflict errors.
7. Real capability revocations are enforced at the next admission boundary.
8. Failed replacement is visible, retryable, and does not destroy the working
   generation or silently continue stale execution.
9. SDK and RPC modes implement identical product semantics.
10. Desktop and CLI expose the same Host-owned state and recovery actions.

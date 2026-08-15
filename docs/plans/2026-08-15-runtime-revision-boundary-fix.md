# Runtime Revision Boundary Fix

Status: Implemented

## Problem

Cross-provider model changes can fail with `runtime-reload-revision-mismatch` after the Desktop composer persists its selected model or thinking level. The Desktop-only change updates the full Settings revision, but the resident agent runtime is intentionally not rebuilt for that change. The next cross-provider replacement compiles from the newer full configuration and compares it with the older resident-runtime revision, so the guard rejects a valid candidate before any provider request is made.

The failure is timing-sensitive because `persistComposerProfile` starts the settings write without awaiting it. Same-provider model changes and cold sessions do not use the same replacement path, which makes the issue appear provider-specific or intermittent.

## Design decisions

### 1. Separate document revision from runtime revision

Keep `SettingsSnapshot.revision` as the full normalized `PiwinConfig` revision. It is used for Settings optimistic concurrency and must continue to change when Desktop state changes.

Add a runtime-specific revision, initially named `runtimeRevision`, computed from an explicit, pure runtime-settings projection:

```text
revision        = hash(full normalized product config)
runtimeRevision = hash(runtime-affecting settings projection)
```

Do not fix this by deleting the guard or by copying the candidate revision into the active runtime without rebuilding it.

The projection must be derived from the actual inputs used to compile the agent runtime blueprint. `desktop` composer state should be excluded. Domains currently classified as immediate must be audited individually: `artifact` and `visionDelegation`, for example, are referenced by blueprint compilation and must not be excluded merely because their timing label says `immediate`.

### 2. Use the runtime revision throughout runtime replacement

The Host settings-apply path should record and schedule replacement using `snapshot.runtimeRevision` for `new-runtime` changes. Runtime status, replacement candidates, prepared sessions, and blueprint diagnostics should compare the runtime revision rather than the full Settings document revision.

For a staged migration, keep the existing wire field as a compatibility alias while adding the clearly named internal/runtime field (`runtimeSettingsRevision` or equivalent). Document the old field as runtime-specific before removing or renaming it in a later protocol change.

### 3. Treat moving settings as supersession, not a user-facing failure

If the target runtime revision changes while a candidate is compiling, the replacement controller should discard or retry the candidate against the latest desired runtime revision. `runtime-reload-revision-mismatch` should remain an internal diagnostic, not a normal user-visible result of a harmless Desktop-only save.

The stronger follow-up is to compile a candidate from an immutable Host-owned settings snapshot captured for the target revision. This should be added at the Host/agent-host composition seam rather than making the UI pass revisions or making `agent-host` own product settings.

### 4. Make Desktop persistence observable

Change the Desktop settings-save queue to return/propagate its Promise and surface an apply failure with context. The model picker should not need to wait for a full runtime reload, but a fire-and-forget settings mutation must not hide an error or create an opaque race.

## Implementation sequence

1. Add a pure runtime-settings projection and `runtimeRevision` to the settings snapshot. Unit-test which fields affect each revision.
2. Thread the runtime revision through blueprint compilation, prepared-session diagnostics, runtime status, and the replacement controller. Preserve the existing compatibility field during migration.
3. Change Host settings apply and model-change replacement to use the runtime revision. Ensure Desktop-only changes leave the resident runtime’s desired/active runtime revision aligned.
4. Add latest-wins handling for a candidate that is superseded during compilation. Follow with immutable candidate input if the current composition seam can support it without violating the Pi-only agent-host boundary.
5. Make `saveSettingsInOrder` awaitable/observable and add a focused error path in Desktop.
6. Update ADR 0048 and the settings/runtime documentation with the two-revision model and the domain projection rules.

## Regression matrix

### Pure revision tests

- Changing `desktop.composerProfile` changes `revision` but does not change `runtimeRevision`.
- Changing `desktop.lastSession` has the same property.
- Changing a provider, runtime default, web/tool setting, skill/extension input, or another confirmed blueprint input changes `runtimeRevision`.
- Every domain marked `new-runtime` changes `runtimeRevision`.
- Artifact and vision-delegation behavior is covered explicitly according to whether the compiled blueprint consumes the changed value.

### Runtime integration tests

- Start a resident session on Provider A.
- Apply a Desktop composer-profile change.
- Switch to Provider B and assert the replacement completes without `runtime-reload-revision-mismatch`.
- Assert that the active runtime revision is the candidate runtime revision after replacement.
- Apply a real runtime-affecting settings change and assert that replacement is scheduled and completed.
- Race settings apply with a cross-provider model change and assert latest-wins behavior rather than a user-visible mismatch.
- Preserve same-provider switching and cold-session behavior.

## Acceptance criteria

- The screenshot scenario succeeds after the Desktop composer has persisted its model selection.
- Full Settings optimistic concurrency remains correct; Desktop-only changes still advance `revision`.
- Runtime replacement never treats an unrelated Desktop-only revision as a stale runtime candidate.
- No UI or application package imports Pi packages, and `agent-host` remains the only Pi-dependent package.
- Focused host-runtime tests, full typecheck, and the touched-package test suite pass.

## Non-goals

- Do not remove the runtime generation boundary for cross-provider model changes.
- Do not force every Desktop preference change to rebuild the agent runtime.
- Do not make the UI responsible for runtime revision compare-and-swap.
- Do not change provider credentials, CliproxyAPI behavior, or model availability as part of this fix.

## Implementation note

The first implementation keeps the existing `settingsRevision` names on
runtime status and replacement internals as compatibility fields, but their
value is now `SettingsSnapshot.runtimeRevision`. Full document CAS continues
to use `SettingsSnapshot.revision`.

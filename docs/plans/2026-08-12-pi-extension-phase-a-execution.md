# Pi Extension Phase A Execution

> Status: implemented and locally verified
> Date: 2026-08-12
> Scope: the safe activation MVP from [`pi-extension-productization.md`](../specs/pi-extension-productization.md)

## Delivered

- Added `@piwin/extensions` with an immutable content-addressed revision store,
  atomic registry writes, deployment records, symlink rejection, and revision
  history under `~/.piwin/extensions/`.
- Changed local and Git extension installation to stage inactive revisions
  without replacing an existing directory or importing the extension.
- Added extension registry, runtime binding, deployment phase, extension-set
  revision, HostCommand, HostPush, and runtime-status contracts.
- Added `extensions/apply` to HostRuntime. It uses the existing candidate
  Runtime replacement transaction, supports `now`, `after-current-run`, and
  `new-sessions-only`, persists deployment progress, and preserves the old
  generation when candidate preparation or publication fails.
- Added managed `extensions/set_enabled`, catalog/deployment pushes, exact
  `contentRevision` propagation into the ResourceCatalog/ResourceManifest, and
  `extensionSetRevision` in the capability snapshot.
- Connected Desktop toggles and remote Host command admission to explicit
  apply semantics; added browser mock behavior for UI tests.
- Added architecture/package-map documentation and this execution record.

## Intentionally deferred

- Explicit update/rollback/uninstall/quarantine/garbage-collection commands.
- Dependency materialization, install-script policy, compatibility doctor, and
  package-signature/provenance checks.
- Full SDK/worker side-effect canary validation of third-party entrypoints.
- CLI resource-management subcommands beyond the shared Host command lane.

## Verification

- `pnpm typecheck` — passed for all 30 runnable workspace projects.
- `pnpm test` — passed for all workspace test suites, including the new
  `@piwin/extensions` tests.
- `pnpm test:architecture` — passed (`Package boundaries OK`).
- `pnpm exec prettier --check ...` and `git diff --check` — passed for touched
  feature files.
- Focused Host, Runtime Replacement, resource-policy, marketplace,
  host-transport, host-server, Desktop typecheck, and extension-store tests —
  passed.

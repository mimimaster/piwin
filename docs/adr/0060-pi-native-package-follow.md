# ADR 0060: Follow Pi package inventory without write-back

| Field | Value |
|-------|-------|
| Status | Accepted — amended 2026-09-14 |
| Date | 2026-08-22 |
| Extends | [ADR 0002](./0002-config-root-piwin.md), [ADR 0010](./0010-pi-extensions-channel.md), [ADR 0016](./0016-general-workspace-sessions.md), [ADR 0047](./0047-managed-pi-extension-activation.md), [ADR 0048](./0048-settings-runtime-hot-apply.md) |
| Product spec | [Pi 原生包跟随](../specs/2026-08-22-pi-native-package-follow.md) |

## Context

Pi users install with `pi install`, which writes `~/.pi/agent/settings.json` `packages[]`. piwin Host compiles exact resource paths and creates `DefaultResourceLoader` with `noExtensions: true`. Scanners only read `~/.piwin` (plus project / extraPaths). A successful `pi install` never enters the catalog or `additionalExtensionPaths`.

piwin already has a Settings hub with list + **Refresh**. That is a sync control. The missing work is: the catalog read does not include Pi's inventory.

Manual install (`extensions/install`) stages into `~/.piwin/extensions/revisions` and injects paths at Runtime compile. It does not write Pi settings. Two disks, one view — that remains. The marketplace also exposes Pi ecosystem packages whose correct installation semantics include npm dependencies, lifecycle scripts, and bundled Skills/Prompts; treating those as flat managed extensions is incorrect.

## Decision

1. **This is a catalog sync problem**, not a command hook and not a file watcher. Every `extensions/list` / `skills/list` / `prompts/list` / Blueprint compile **re-reads** Pi inventory and unions it with the existing piwin scan. No stored sync cursor, no write-back.
2. **Refresh is the user-facing sync.** List rebuilds the view from disk. Refresh (with a live session) also calls existing `extensions/apply` so the current Agent generation picks up the new set. Opening the panel already lists; Refresh is “read again and apply.”
3. **Keep Phase A.** Managed revisions, local/git install, `set_enabled`, `extensions/apply`, `scanExtensions` of `~/.piwin`, extraPaths, and shadow diagnostics stay. Do not add a second lifecycle (no bash `finally` coordinator, no `fs.watch`, no HostRuntime fingerprint store, no copy of Pi packages into revisions).
4. **One merge seam.** A single host-runtime helper loads piwin scans + Pi-native entries and is used by both catalog list commands and `createPiResourceLoader`. Do not concat in two places.
5. **Pi inventory is read-only `pi-native` (project packages are `project`).** Precedence remains `bundled → user → project → mapped → pi-native`. `defaultSources()` must allow `pi-native`. `packages[]` is never written by piwin install.
6. **`pi-native` defaults to enabled** when the static scan is `compatible`. Disable via existing `disabledIds`. Managed installs stay inactive until the user enables them (ADR 0047). Do not silently write `disabledIds` for TUI-incompatible packages.
7. **Loader flags stay off.** `noExtensions` / `noSkills` / `noPromptTemplates` remain. Host is still the only discovery authority.
8. **test-host / non-default `PIWIN_ROOT` does not follow** user-global `~/.pi/agent`. Project `.pi/` packages may still load when the session project is trusted.
9. **TUI-incompatible extensions are listed, not loaded.** Static scan (no module execute) classifies `compatible` / `degraded` / `incompatible` / `unverified`. Only `compatible` is `enabled` by default and included in `collectExtensionEntryPaths`.
10. **Explicit marketplace installation is the write exception.** A user-confirmed `marketplace/package-install` calls Pi's `PackageManager.installAndPersist` through `@piwin/agent-host`, targeting the Host user's Pi agent directory. This is equivalent to the displayed `pi install` operation, including dependency and lifecycle-script execution. Passive inventory reads, refresh, Blueprint compilation, and piwin managed installs remain read-only toward Pi settings. Desktop must identify unverified packages and disclose Host-user execution before confirmation.

## Consequences

- `pi install` then Refresh (or a new session) is enough. The marketplace can perform the same Pi package installation after an explicit user confirmation, without requiring a terminal.
- Standalone Pi TUI still does not see `~/.piwin` managed extensions.
- Agent-driven `pi install` becomes live after the user Refresh-applies or the next generation compiles. That is a deliberate sync gesture, not silent self-authorization mid-run.

## Alternatives rejected

| Option | Why rejected |
|--------|----------------|
| Wrap / intercept `pi` | Absolute paths, npx, and hand-edited JSON bypass argv |
| `fs.watch` / extra process | Extra waiter; Refresh and compile already re-read |
| Reconcile after every `bash` | Heavier than watching one JSON file; stacks a second lifecycle on HostRuntime |
| Write piwin installs into `packages[]` | Bidirectional loop, duplicate loads |
| Copy Pi packages into `~/.piwin/extensions` | Second tree, update drift |
| Re-enable Pi discovery | Host Blueprint stops being authoritative |
| Rip out Phase A managed store | Manual local/git install and immutable apply still need it |

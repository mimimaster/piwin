# ADR 0097: Desktop in-app update (signed updater bundles, prompt then one-click install)

- **Status**: Accepted
- **Date**: 2026-10-21
- **Scope**: `scripts/release-desktop.mjs` + `scripts/lib/release-*`, `apps/desktop/src-tauri` (`app_update`), `apps/desktop/src` (update store, sidebar notice area, Settings → General → Version), `@piwin/contracts` `HostStatusData`, `@piwin/host-runtime` status
- **Consults**: ADR 0017 (sidecar bundling), ADR 0096 (quit reaps the Host sidecar), `docs/guides/desktop-release.md`, research `docs/plans/2026-10-21-update-push-research.md`

## Context

Releases already ship from one command to immutable R2 keys, with
`releases.json` flipped last. The installed app only learned about a new
version when the user opened Settings → General, and then sent them to the
download page to reinstall by hand. Releases are close to daily patch builds,
so most installs ran stale.

## Decision

1. **Tauri updater plugin (v2), static per-platform manifests.**
   `tauri-plugin-updater` checks
   `https://dl.piwinwin.com/updater/{{target}}-{{arch}}.json`
   (`darwin-aarch64.json`, `windows-x86_64.json`). One file per platform,
   because the Tauri static format carries a single `version`: a
   `--skip-windows` release must move macOS without pointing Windows at a
   bundle that does not exist. `releases.json` keeps its schema and remains
   the download page's source.
2. **Signed bundles, signed on the Mac only.** Updater signatures (minisign)
   are mandatory. The private key lives outside the repo next to the release
   config (`updater.privateKeyPath`, default
   `~/.piwin/skills/piwin-desktop-release/updater.key`); the public key is in
   `tauri.conf.json > plugins.updater.pubkey`. `createUpdaterArtifacts` stays
   off: packaging (dev, CI) never needs the key. The release script signs:
   - macOS: the `.app` is taken from the **notarized, stapled DMG**, stapled
     itself, archived as `piwinwin_<v>_aarch64.app.tar.gz` (top-level
     `piwin.app`, no AppleDouble files) and signed. Tauri's own archive is
     produced before notarization and would ship an un-ticketed app.
   - Windows: the NSIS `-setup.exe` fetched from the build box is signed on
     the Mac (the signature covers bytes, not a machine), so the key never
     reaches the build box.
   Bundles and `.sig` files go to the versioned release keys; the updater
   manifests are written after every upload is verified, before
   `releases.json`, with the same short cache.
   Losing the key strands every install on its current version: it is backed
   up offline; `release:plan` blocks when the key is missing or its `.pub`
   differs from `tauri.conf.json`.
3. **Prompt, then one-click install; every release is offered.** Patch and
   formal releases are both pushed. Rust checks 30 s after launch and every
   6 h, and emits `app-update://available`. While a newer version is
   published, the sidebar notice area (bottom of the sidebar, above
   Settings) keeps a resident card with **Update now**, download progress,
   the busy-session prompt and failures; it cannot be dismissed and leaves
   only once the app runs that version. (Amended 2026-10-22 by the product
   owner: this replaced a one-time toast per version.) Settings → General →
   Version shows the version, an **Update now** button and download progress. Development
   builds (`0.0.0`) and the shell-only build never check (the shell-only app
   has another bundle id and no published bundle).
4. **Host safety before replacement.** `app_update_install` first asks the
   local sidecar for `host/status.busySessionCount` (new optional field:
   resident runtimes in `resident-busy`). When it is non-zero and the user did
   not confirm, it returns `busy` and the UI asks again. Then:
   - macOS: download → replace the bundle → `request_restart()`. The restart
     goes through `ExitRequested`, so the ADR 0096 graceful teardown reaps
     the Host before the new version starts.
   - Windows: the installer must exit the app; the updater's
     `on_before_exit` runs `run_terminal_teardown_blocking` (ADR 0096) so the
     sidecar's files are released before NSIS (passive mode, `/UPDATE`) runs.
5. **Failures degrade to the download page.** A failed check stays silent; a
   failed install (unwritable location, translocated app, network) shows the
   error and keeps the "Download" button (the sidebar card also offers
   "Retry").

## Consequences

- One click and a restart replace a manual reinstall; TCC grants survive
  because the Developer ID identity does not change.
- Updates are full downloads (~110 MB macOS, ~70 MB Windows); no deltas.
- No downgrade: a bad release is fixed forward. Re-pointing a manifest only
  stops installs that have not updated yet.
- Remote Host update notices, CLI client version, channel selection and
  "skip this version" remain open (research P2/P3).

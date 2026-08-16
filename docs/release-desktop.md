# Desktop release path (unsigned OK for private v1)

## Goal

Build an installable Desktop artifact from a clean checkout. Store signing /
notarization is **optional** (residual **D-ENG-03b** when certs unavailable).

> **Distribution status (ADR 0017):** packaging now runs `pnpm bundle:host` +
> `pnpm fetch:node-runtime` before `tauri build`, and the Rust host bridge
> prefers the packaged sidecar when `host/host-serve.mjs` is present.
> **Clean-machine smoke (S5) is still required** before treating installers as
> public-ready — until then, prefer internal/dev distribution. See
> `docs/plans/2026-07-26-host-sidecar-bundling-execution-plan.md`.

## Prerequisites

### Build machine

- Node `>= 20`, pnpm `9.x`
- Rust toolchain (`rustup`, `cargo`) for Tauri
- Platform deps for Tauri 2 (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))
- Network access once to download the pinned Node LTS used by
  `scripts/fetch-node-runtime.mjs` (cached under `~/.cache/piwin-build/`)
- Doc Cards V2 ships `@lancedb/lancedb` with **one** platform native
  (`lancedb.<os>-<arch>.node`, ~216 MiB). Sidecar packaging must not bundle
  every optional native package. FTS must use the ICU tokenizer (see
  `docs/notes/2026-08-16-lancedb-sidecar-spike.md`).

### End-user machine (after S5 passes)

- No pnpm / tsx / source checkout required for packaged builds.
- Dev (`pnpm dev:tauri`) still uses workspace `pnpm`/`tsx` (tier 2).

## One-command package

From repo root:

```bash
pnpm install
pnpm package:desktop
```

This runs, in order:

1. `pnpm bundle:host` — esbuild `dist-host/host-serve.mjs` + pruned
   `node_modules` + `bundled-assets` (S0 layout)
2. `pnpm fetch:node-runtime` — official Node LTS →
   `apps/desktop/src-tauri/binaries/piwin-host-<triple>`
3. `tauri build` — embeds `externalBin` + `host/` resources

Optional scripted bundle smoke (not part of default `pnpm test`):

```bash
pnpm bundle:host
pnpm test:bundle
```

## Artifact locations (typical)

- macOS: `apps/desktop/src-tauri/target/release/bundle/dmg/` and `macos/`
- Linux: `apps/desktop/src-tauri/target/release/bundle/deb/` / `appimage/`
- Windows: `apps/desktop/src-tauri/target/release/bundle/msi/` / `nsis/`

Exact paths depend on `tauri.conf.json` product name.

## Signing / notarization

Not required for private v1. When certs exist, document platform-specific env
vars in a follow-up and promote **D-ENG-03** from residual to active.

## CI note

Default CI runs `pnpm typecheck` + `pnpm test` + host smoke only. Full desktop
package is a **manual gate** unless the agent image has Rust + platform deps.

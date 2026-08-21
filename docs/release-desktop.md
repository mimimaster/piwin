# Desktop release path (unsigned OK for private v1)

## Goal

Build an installable Desktop artifact from a clean checkout. Store signing /
notarization is **optional** (residual **D-ENG-03b** when certs unavailable).

> **Distribution status (ADR 0017):** packaging now runs `pnpm bundle:host` +
> `pnpm fetch:node-runtime` before `tauri build`, and the Rust host bridge
> prefers the packaged sidecar when `host/host-serve.mjs` is present.
> Host bundle pins Pi `@earendil-works/pi-coding-agent@0.84.2` and Node
> `v22.19.0` (Pi 0.84 engines). **Clean-machine smoke (S5) is still required**
> before treating installers as public-ready — until then, prefer
> internal/dev distribution. See
> `docs/plans/2026-07-26-host-sidecar-bundling-execution-plan.md`.
> Shell / Host split packaging: `docs/plans/2026-08-19-shell-host-split-packaging.md`.

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

Three artifacts. **Do not run the all-in-one Desktop app and a standalone Host
on the same `~/.piwin` at once.**

### All-in-one Desktop (shell + local Host)

```bash
pnpm install
pnpm package:desktop
```

1. `pnpm bundle:host` — `dist-host/host-serve.mjs` + `host-listen.mjs` + worker + pruned `node_modules`
2. `pnpm fetch:node-runtime` — Node `v22.19.0` → `apps/desktop/src-tauri/binaries/piwin-host-<triple>`
3. `tauri build` with `tauri.conf.sidecar.json` — embeds Host files

### Thin shell (no local Host)

```bash
pnpm package:desktop-shell
```

Same UI, no Host files, no bundled Node. Opens on the connect wall. Connect
`ws://127.0.0.1:8787` (or a remote address) after the standalone Host is up.

Dev: `pnpm dev:tauri:shell`

### Standalone Host

```bash
pnpm package:host
```

Writes `dist/piwin-host/`. Start with `./start-host.sh` (listens on
`ws://127.0.0.1:8787`, includes `agent-worker.mjs`). Then open the thin shell
and connect.

Optional JSONL sidecar smoke (not part of default `pnpm test`):

```bash
pnpm bundle:host
pnpm test:bundle
```

## Artifact locations (typical)

- macOS: `apps/desktop/src-tauri/target/release/bundle/dmg/` and `macos/`
- Linux: `apps/desktop/src-tauri/target/release/bundle/deb/` / `appimage/`
- Windows: `apps/desktop/src-tauri/target/release/bundle/msi/` / `nsis/`
- Standalone Host: `dist/piwin-host/`

Thin-shell product name is `piwinwin Shell` (`app.piwinwin.desktop.shell`).
All-in-one remains `piwinwin`.

## Signing / notarization

Not required for private v1. When certs exist, document platform-specific env
vars in a follow-up and promote **D-ENG-03** from residual to active.

## Session cold storage gate (R1)

Before treating a Desktop build as complete for session backup / offload /
restore, run the focused fault suite and the repo check:

```bash
pnpm test:cold-storage
pnpm check
```

`pnpm check` is `typecheck` + `test` + `test:architecture`. The focused suite
covers pack hashing, body guards, journal crash recovery, Host/CLI commands,
and Desktop restore-first settings. Operator recovery lives in
[`guides/session-cold-storage.md`](./guides/session-cold-storage.md) (ADR 0044).

## CI note

Default CI runs `pnpm typecheck` + `pnpm test` + host smoke only. Full desktop
package is a **manual gate** unless the agent image has Rust + platform deps.

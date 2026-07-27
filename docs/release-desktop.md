# Desktop release path (unsigned OK for private v1)

## Goal

Build an installable Desktop artifact from a clean checkout. Store signing /
notarization is **optional** (residual **D-ENG-03b** when certs unavailable).

> **Distribution caveat (current state):** the packaged app still spawns the
> host via `pnpm … tsx` (dev-mode spawn, ADR 0006), so the target machine
> needs the source checkout + pnpm + tsx. Public distribution requires the
> self-contained host sidecar — see **ADR 0017
> (`adr/0017-host-sidecar-bundling.md`)** for the bundling plan and smoke
> gate. Until ADR 0017 lands, treat artifacts as internal-only.

## Prerequisites

- Node `>= 20`, pnpm `9.x`
- Rust toolchain (`rustup`, `cargo`) for Tauri
- Platform deps for Tauri 2 (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

## One-command package

From repo root:

```bash
pnpm install
pnpm package:desktop
```

This runs `tauri build` in `apps/desktop` (unsigned by default).

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

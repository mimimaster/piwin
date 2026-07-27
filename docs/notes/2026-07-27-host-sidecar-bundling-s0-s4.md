# Host sidecar bundling — S0–S4 implementation note

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Branch / worktree | `feat/host-sidecar-bundling` @ `/Volumes/BigDisk/Projects/Projects/piwin-host-bundling` |
| Plan | `docs/plans/2026-07-26-host-sidecar-bundling-execution-plan.md` |
| ADR | `docs/adr/0017-host-sidecar-bundling.md` (Implementation in progress) |

## Landed

| Slice | What |
|-------|------|
| **S0** | `resolveBundledAssetsRoot` in agent-host / theme / pet / skills; env `PIWIN_BUNDLED_ASSETS_ROOT` + layout paths; unit tests |
| **S1** | `scripts/bundle-host.mjs` (esbuild + npm install externals + assets); `pnpm bundle:host`; `pnpm test:bundle` smoke green (`host/status` mock) |
| **S2** | `scripts/fetch-node-runtime.mjs` pins Node **v22.14.0**, SHA256 from SHASUMS256, cache `~/.cache/piwin-build/`, output `binaries/piwin-host-<triple>` |
| **S3** | `tauri.conf.json` `externalBin` + `resources` → `host/*` |
| **S4** | Rust two-tier `resolve_host_command_tiered` + `host-log` tier line; cargo unit tests for packaged/dev/fallback |

## Verified on this machine

```text
pnpm --filter @piwin/agent-host --filter @piwin/theme --filter @piwin/pet --filter @piwin/skills test  # S0
pnpm bundle:host && pnpm test:bundle   # S1 smoke
pnpm fetch:node-runtime                # S2
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml host_bridge  # S4
```

## Not done (still on you / later)

| Slice | Notes |
|-------|-------|
| **S5** | Clean-machine smoke (install artifact, no pnpm/tsx/checkout). Gate for ADR **Accepted**. |
| **S6** | Full docs flip after S5 evidence. Partial doc updates already landed (release-desktop, architecture transport row, ADR status). |
| **Windows** | Scripts have triple/exe hooks; not smoke-tested. |

## Packaging notes

- `pnpm package:desktop` = `bundle:host` → `fetch:node-runtime` → `apps/desktop package`.
- Tauri build requires `dist-host/*` and `binaries/piwin-host-<triple>` to exist; use `pnpm ensure:packaging-placeholders` + `fetch:node-runtime` before bare `cargo test` if needed.
- Externals: `@earendil-works/pi-coding-agent@0.80.10`, `@silvia-odwyer/photon-node@0.3.4` installed into `dist-host` via npm (not monorepo deploy) so resolution is stable.

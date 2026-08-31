# ADR 0017: Self-contained host sidecar (bundle Node host for distribution)

| Field | Value |
|-------|-------|
| Status | **Implementation in progress** (S0–S4 landed on `feat/host-sidecar-bundling`; S5 clean-machine smoke is the gate to **Accepted**) |
| Date | 2026-07-26 |
| Related | ADR 0006 (dev sidecar spawn), ADR 0015 (async transport), `docs/release-desktop.md`, `docs/ipc-transport-discipline.md` |

## Context

The packaged desktop app currently starts the host via
`pnpm --filter @piwin/cli exec tsx src/index.ts host serve`
(`apps/desktop/src-tauri/src/host_bridge.rs::resolve_host_command`). This
requires the end user's machine to have:

1. the piwin **source checkout** (workspace layout),
2. `pnpm` on PATH,
3. `tsx` installed.

That is fine for private development (ADR 0006 accepted this consequence) but
unacceptable for open-source distribution: a downloaded `.dmg`/`.msi` must run
without Node tooling installed. Pi (`@earendil-works/pi-coding-agent`) is a
plain npm library, so a correctly bundled host makes the entire app
self-contained — no external `pi` install, no pi service.

### Bundling constraints discovered in Pi 0.80.10

- Pi is pure ESM with subpath export `./rpc-entry`.
- Pi ships **runtime assets** outside JS: interactive-theme JSON,
  `export-html` templates, PNG assets, and
  `@silvia-odwyer/photon-node` **WASM** (`photon_rs_bg.wasm`).
- Pi depends on `jiti` (runtime TS/ESM loader) — a hint that Pi itself may
  perform dynamic file loading that a single-file bundle can break.
- agent-host uses `await import('@earendil-works/pi-coding-agent')` in
  `sdk-adapter.ts`, `pi-resource-loader.ts`, `gated-bash-tool.ts` — static
  bundlers handle this fine, but the specifier must remain analyzable.
- Optional external-process path: spawning stock `pi --mode rpc`
  (`PIWIN_RPC_STOCK`) stays a **user-provided** binary; it is explicitly out of
  bundling scope.

Because of the asset/WASM/jiti constraints, a naive "one JS file" bundle is
fragile. We bundle to a **directory** (JS bundle + preserved node_modules
assets), not to a single file.

## Decision

1. **Ship the host as a Tauri sidecar directory**: a bundled JS entry
   (`host-serve.mjs`) plus required runtime assets, executed by a
   **bundled Node runtime binary** registered via Tauri `externalBin`.
2. **Bundler: esbuild**, `platform=node`, `format=esm`, with
   `@earendil-works/pi-coding-agent` and asset-carrying deps marked
   **external** and shipped via a pruned production `node_modules` (see
   Step 2). Rationale: keeps Pi's on-disk asset layout intact instead of
   fighting per-asset loaders.
3. **Node runtime**: download the official Node LTS binary per target triple at
   package time. (Revisit single-binary SEA/Bun later; both need a
   compatibility spike against Pi's WASM + jiti usage.)
4. **`resolve_host_command` gains a two-tier resolution**:
   1. packaged sidecar (production),
   2. current `pnpm … tsx` path (development fallback, unchanged). This is a
      packaging resolver fallback only; it is not an Agent backend fallback.

The host bundle includes the piwin-owned `agent-worker.mjs` artifact beside
`host-serve.mjs`; runtime worker ownership remains inside the single Product
Host composition root.
5. Dev workflow (`pnpm tauri dev`, CLI) is **unchanged**; bundling is a
   packaging-time concern only.
6. The packaged Host carries `bundled-assets/default-config.json` as a
   first-run seed. It is read only when the target user's
   `~/.piwin/config.json` does not exist; an existing user config always wins.
   The seed is config-only, so provider credentials remain env/keychain
   references rather than raw secrets.

## Implementation steps

### Step 0 — Preconditions

- [ ] `piwin host serve` has no `import.meta.url`-relative reads into piwin
      source dirs (audit `apps/cli/src` + `packages/*/src`; any data files it
      reads must resolve from `~/.piwin` / `~/.pi` or be inlined).
- [ ] Contracts wire discipline holds (`docs/ipc-transport-discipline.md`) —
      the sidecar boundary is exactly the JSONL protocol, nothing else.

### Step 1 — Create the bundle script

Add `scripts/bundle-host.mjs` (repo root), invoked as `pnpm bundle:host`:

```js
// scripts/bundle-host.mjs (sketch)
import { build } from 'esbuild';

await build({
  entryPoints: ['apps/cli/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist-host/host-serve.mjs',
  // Keep Pi + asset/native-ish deps on disk; everything @piwin/* gets inlined.
  external: [
    '@earendil-works/pi-coding-agent',
    '@silvia-odwyer/photon-node',
  ],
  banner: {
    // ESM bundles lose require(); some transitive deps need it.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
```

Notes:

- All `@piwin/*` workspace packages are **inlined** (they are pure TS, no
  runtime assets) — this removes the workspace-layout requirement.
- Externals list will grow empirically: run the smoke test (Step 5), add any
  dep that fails on missing assets/dynamic loading to `external`.

### Step 2 — Produce the pruned production `node_modules`

The externals from Step 1 must exist next to the bundle:

```bash
# in a throwaway staging dir
pnpm deploy --filter @piwin/cli --prod dist-host/staging
# keep only the packages actually external to the bundle:
#   dist-host/node_modules/@earendil-works/**  (+ its transitive deps)
#   dist-host/node_modules/@silvia-odwyer/**
```

`pnpm deploy --prod` gives a self-contained, symlink-free `node_modules`.
A prune pass deletes packages already inlined by esbuild (script can diff the
esbuild metafile against the deployed tree). Verify
`photon_rs_bg.wasm` and Pi's `dist/**` assets survive.

### Step 3 — Fetch the Node runtime per target

Extend `scripts/bundle-host.mjs` (or a sibling script) to download and unpack
the official Node LTS build for the target triple and place it as:

```text
apps/desktop/src-tauri/binaries/piwin-host-<target-triple>[.exe]
```

Tauri requires `externalBin` names suffixed with the target triple
(e.g. `piwin-host-aarch64-apple-darwin`). The "binary" here is the Node
executable renamed; the JS bundle + node_modules ride along as `resources`.

### Step 4 — Wire Tauri config

`apps/desktop/src-tauri/tauri.conf.json`:

```jsonc
{
  "bundle": {
    "externalBin": ["binaries/piwin-host"],
    "resources": {
      "../../dist-host/host-serve.mjs": "host/host-serve.mjs",
      "../../dist-host/node_modules": "host/node_modules"
    }
  }
}
```

Add root script:

```jsonc
// package.json
"bundle:host": "node scripts/bundle-host.mjs",
"package:desktop": "pnpm bundle:host && pnpm --filter @piwin/desktop tauri build"
```

### Step 5 — Update `resolve_host_command` (Rust)

In `apps/desktop/src-tauri/src/host_bridge.rs`:

```text
fn resolve_host_command(mock) ->
  1. if packaged sidecar exists:
       program = resource_dir/binaries/piwin-host (via tauri path resolver)
       args    = [resource_dir/host/host-serve.mjs, "host", "serve", "--mode", "sdk", ...]
  2. else (dev): current pnpm/tsx spawn, unchanged
```

- Resolution of the resource dir uses Tauri's `PathResolver`, not hardcoded
  paths.
- Log which tier was chosen via the existing `host-log` event so failures are
  diagnosable from the UI.

### Step 6 — Smoke test (must pass before ADR flips to Accepted)

On a machine/user account **without** pnpm/tsx/piwin checkout:

- [ ] Install the built artifact, launch app.
- [ ] `host_start` succeeds; `host/status` push shows `ready: true, mock: false`.
- [ ] Open a project, run one real model turn end-to-end (`run/phase` →
      `run/terminal completed`).
- [ ] Paste an image → saved under `~/.piwin/media/` (exercises photon/WASM
      path if resize is involved).
- [ ] Skills/extension listing works (exercises Pi ResourceLoader file access).
- [ ] Quit → sidecar exits gracefully (`ShutdownDisposition::Graceful`).

Add a scripted variant (`scripts/smoke-packaged-host.sh`) that runs the bundle
directly: `binaries/piwin-host host/host-serve.mjs host serve --mock` and
asserts a `host/status` JSONL line — cheap CI coverage without Rust.

### Step 7 — Docs

- [ ] Update `docs/release-desktop.md`: prerequisites drop "user needs pnpm";
      build machine still needs full toolchain.
- [ ] Flip this ADR to **Accepted** with the smoke evidence linked.

## Consequences

- Packaged app is fully self-contained: Pi travels inside the sidecar bundle;
  users install nothing besides the app.
- Bundle size grows by ~a Node runtime (~50 MB compressed per platform).
  Acceptable for v1; SEA/Bun single-binary is a future optimization with its
  own compatibility spike.
- Pi upgrades now have a second checkpoint: after bumping the pinned version,
  re-run Step 6 smoke (assets/externals may have changed).
- The dev-mode spawn path remains, so ADR 0006's dev ergonomics are untouched.

## Rejected alternatives

- **Single-file bundle including Pi**: breaks on Pi's theme/template/WASM
  asset reads and risks `jiti` dynamic loading; would require patching asset
  resolution inside a dependency we promised not to fork.
- **Require users to `npm i -g` a piwin host package**: reintroduces the
  external-toolchain requirement the ADR exists to remove.
- **Bun `--compile` now**: attractive (Pi itself uses it for its own binary),
  but adopting a second runtime for our host needs its own spike + ADR;
  revisit after v1 ships.

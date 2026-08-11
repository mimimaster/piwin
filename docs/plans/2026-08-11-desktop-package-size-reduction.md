# Desktop package size reduction — execution plan

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Status | **Phase 1 in progress** |
| Trigger | Measured release `.app` ≈ **344MB** (transfer of bare app tree ~300MB+) |
| Related | [ADR 0017](../adr/0017-host-sidecar-bundling.md), [release-desktop.md](../release-desktop.md), host sidecar plan `2026-07-26-host-sidecar-bundling-execution-plan.md` |

## Goal

Reduce the **installable Desktop artifact payload** users actually transfer and
install, without breaking the self-contained host sidecar (ADR 0017).

Primary success metric is **on-disk `.app` / resources size** and the official
installer (`.dmg` / zip). Transfer of a bare uncompressed `.app` folder is a
usage mistake, not the packaging target.

## Measured baseline (this machine, 2026-08-11)

| Path inside `.app` | Size | Share |
|--------------------|------|-------|
| `Contents/Resources/host/node_modules` | **216MB** | 63% |
| └ `@earendil-works/pi-coding-agent` (+ nested) | **173MB** | 50% |
| `Contents/MacOS/piwin-host` (Node LTS rename) | **108MB** | 31% |
| `Contents/MacOS/piwin-desktop` (Tauri + UI) | **~20MB** | 6% |
| **Total bare `.app`** | **~344MB** | 100% |
| zip of same `.app` | **~116MB** | — |
| official `.dmg` | **~96MB** | — |

`dist-host` before prune (build tree, not yet installer): **~205MB**, of which
`node_modules` ≈ **197MB**.

Conservative **safe-to-delete** inventory inside `dist-host/node_modules`
(darwin-arm64 build):

| Category | ≈ Size | Risk |
|----------|--------|------|
| `*.map` source maps | ~43MB | None at runtime |
| `*.d.ts` / `*.d.mts` / `*.d.cts` | ~23MB | None (JS already present) |
| Non-native `@mariozechner/clipboard-*` | ~8MB | None if keep native + universal |
| Nested duplicate `@silvia-odwyer/photon-node` under Pi | ~2MB | Low if top-level photon kept |
| README / extra markdown (keep `CHANGELOG.md`) | ~2MB | Low |
| **Phase 1 total** | **~74–78MB** | Safe |
| Pi `docs/` + `examples/` | ~4MB | **Keep** (system prompt points agents there) |
| `playwright-core` | ~12MB | **Keep** (browser tools) |
| `esbuild` + `@esbuild/<native>` | ~10MB | **Keep** (browser element pick) |
| Node LTS `piwin-host` | 108MB | Out of Phase 1 (ADR future: Bun/SEA spike) |
| Provider SDK JS bodies | large | Out of Phase 1 (needs optional-provider design) |

Also found: packaged app **does not embed** `dist-host/agent-worker.mjs`
(Tauri `resources` omit it) → RPC worker path broken in installers. Fix in
Phase 1 (correctness, not size).

## Non-goals (Phase 1)

- Replacing Node LTS with Bun `--compile` / Node SEA (needs separate spike + ADR).
- Dropping provider SDKs or making them download-on-demand.
- Dropping `playwright-core` / `esbuild` from the host bundle.
- Signing / notarization.
- Changing dual-mode host contracts or Pi version.
- Drive-by Desktop UI work.

## Constraints

- ADR 0017 directory layout stays: `host-serve.mjs` + `node_modules` +
  `bundled-assets` + Node `externalBin`.
- Prune runs **only** on `dist-host/node_modules` after `npm install` of
  externals — never on the monorepo `node_modules`.
- Dev path (`pnpm dev:tauri` / workspace tsx) unchanged.
- `apps/*` still never import Pi.
- Every slice leaves: prune unit tests green + `pnpm test:bundle` green after
  `pnpm bundle:host`.

## Phases

### Phase 1 — Safe prune + ship worker (this plan)

**Owners:** `scripts/bundle-host.mjs`, `scripts/lib/prune-host-node-modules.mjs`,
`apps/desktop/src-tauri/tauri.conf.json`, `docs/release-desktop.md`

1. Extract a pure prune helper with explicit keep rules:
   - Delete `*.map`.
   - Delete declaration files `*.d.ts` / `*.d.mts` / `*.d.cts`.
   - Delete `README.md` / `*.md` **except** any `CHANGELOG.md`.
   - **Do not** delete Pi package `docs/` or `examples/` trees.
   - Delete `@mariozechner/clipboard-*` packages that are not in the
     platform keep-set (native triple + `darwin-universal` on macOS + the
     JS meta package `clipboard`).
   - If both top-level and nested `photon-node` exist, drop the **nested**
     copy under `pi-coding-agent/node_modules`.
2. Call prune at end of `bundle-host.mjs`; print before/after bytes and a
   per-category report.
3. Add `agent-worker.mjs` to Tauri `bundle.resources` next to `host-serve.mjs`
   so `new URL('./agent-worker.mjs', import.meta.url)` resolves in the app.
4. Unit-test prune keep/drop rules on a fixture tree (no full npm install).
5. Document transfer guidance: prefer `.dmg` / zip; do not rsync bare `.app`.

**Acceptance**

- [ ] `pnpm bundle:host` completes; log shows Phase-1 bytes removed ≥ 50MB on
      a full external install (or reports 0 only when `node_modules` already
      pruned / missing).
- [ ] `pnpm test:bundle` still sees `host/status` (or mock ready) within timeout.
- [ ] Prune unit tests cover: keeps native clipboard, drops foreign clipboard,
      drops maps/d.ts, keeps `CHANGELOG.md`, keeps `docs/`, drops nested photon
      only when top-level exists.
- [ ] `tauri.conf.json` resources include `agent-worker.mjs`.
- [ ] `docs/release-desktop.md` states size baseline + transfer advice + prune
      step.

**Verification**

```bash
node --test scripts/lib/prune-host-node-modules.test.mjs
pnpm bundle:host
pnpm test:bundle
du -sh dist-host dist-host/node_modules
# optional full package (slow):
# pnpm package:desktop
# du -sh apps/desktop/src-tauri/target/release/bundle/macos/*.app
```

### Phase 2 — Optional / deferred (separate plan or ADR)

| Idea | Est. save | Gate |
|------|-----------|------|
| Platform-specific npm install for optional natives only | already partly done by prune | CI matrix per triple |
| Lazy/optional provider SDK install | tens of MB | product decision: which providers ship offline |
| Drop or slim `playwright-core` when browser feature off | ~12MB | feature flag + install path |
| Node SEA / Bun compile for `piwin-host` | ~50–80MB of the 108MB runtime | WASM + jiti + photon spike |
| Compress resources in DMG only (no code change) | transfer only | docs / release checklist |

Do **not** start Phase 2 in the same PR as Phase 1.

## Stop conditions

- Prune would need to delete Pi `dist/**`, `docs/**`, `examples/**`, WASM, or
  native binary required by the current triple → stop and reassess.
- `pnpm test:bundle` fails after prune → revert prune category, do not ship.
- Full `package:desktop` is optional for Phase 1 landing; required before
  calling the installer “smaller for users” in release notes.

## Rollout

1. Land Phase 1 on current branch with tests + docs.
2. Next internal `pnpm package:desktop` records new `.app` / `.dmg` sizes in
   `docs/notes/` (one short evidence note).
3. Only then consider Phase 2 spikes.

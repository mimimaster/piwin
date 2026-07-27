# Host sidecar bundling — execution plan

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Status | **S0–S4 implemented** on `feat/host-sidecar-bundling` (worktree `piwin-host-bundling`); **S5 clean-machine smoke pending** (gate for ADR Accepted + S6 flip) |
| Implements | [ADR 0017](../adr/0017-host-sidecar-bundling.md) (Implementation in progress → Accepted after S5 smoke) |
| Binding rules | [`ipc-transport-discipline.md`](../ipc-transport-discipline.md), AGENTS.md §1/§2 |
| Branch | `feat/host-sidecar-bundling` in worktree `/Volumes/BigDisk/Projects/Projects/piwin-host-bundling` |

## Goal

A `pnpm package:desktop` artifact that runs on a machine **without**
pnpm / tsx / the piwin source checkout. Host (incl. Pi) ships inside the app
as a Tauri sidecar: bundled JS + pruned `node_modules` + Node LTS runtime.

## Non-goals (do not do)

- Single-binary host (SEA / Bun compile) — future spike, separate ADR.
- Remote host transport — protocol discipline doc already protects it.
- Signing / notarization — stays residual D-ENG-03b.
- Touching `PiRpcAdapter` / stock `pi --mode rpc` spawn (user-provided binary,
  out of scope per ADR 0017).
- Pi version bump — stay on pinned 0.80.10 throughout.
- Drive-by refactors of host/CLI code beyond what bundling forces.

## Constraints

- Dev workflow must remain unchanged: `pnpm dev:tauri`, `pnpm dev:cli`,
  browser-mock e2e all keep working without running the bundler.
- `apps/*` still never import Pi; the bundle script is build tooling, not a
  runtime dependency path.
- Every slice leaves the repo green: `pnpm typecheck && pnpm test`.
- Commits per concern (docs / asset-path fix / bundler / tauri / rust).

## Pre-flight (before the worktree, on main)

Blocked on: other active sessions in this workspace finishing their work.

1. Other sessions commit their own changes.
2. Commit remaining main-workspace changes **by concern** (docs, contracts,
   host, desktop, …) until `git status` is clean. No mixed mega-commit.
3. `pnpm check` green on main.
4. Create worktree:

   ```bash
   git worktree add ../piwin-host-bundling -b feat/host-sidecar-bundling
   cd ../piwin-host-bundling && pnpm install && pnpm check
   ```

## Slices

### S0 — Source-relative asset audit fix (prerequisite, main-worthy on its own)

**Finding (audited 2026-07-26):** five modules resolve repo-internal asset
dirs via `import.meta.url`. After esbuild inlining, `import.meta.url` points
at `host-serve.mjs` inside app resources and every one of these breaks:

| File | Asset dir |
|------|-----------|
| `packages/agent-host/src/ensure-bundled-prompts.ts:14` | `../bundled-prompts` |
| `packages/agent-host/src/ensure-bundled-extensions.ts:14` | `../bundled-extensions` |
| `packages/theme/src/theme-store.ts:41` | `../bundled` |
| `packages/pet/src/pet-store.ts:53` | `../bundled` |
| `packages/skills/src/ensure-bundled.ts:6` | `../../../skills` (repo root `skills/`) |

**Change:**

- Add one resolution seam: `resolveBundledAssetsRoot()` honoring env var
  `PIWIN_BUNDLED_ASSETS_ROOT`; when unset, fall back to today's
  `import.meta.url`-relative path (dev behavior unchanged).
- `theme-store.ts` / `pet-store.ts` gain the optional `bundledRoot` parameter
  the other three already have; all five consult the seam for their default.
- Layout under the override root mirrors package names:
  `<root>/agent-host/bundled-prompts`, `<root>/agent-host/bundled-extensions`,
  `<root>/theme/bundled`, `<root>/pet/bundled`, `<root>/skills`.

**Owner packages:** `agent-host`, `theme`, `pet`, `skills`
(+ tiny path helper — put it in `contracts` only if it stays type/pure;
otherwise duplicate the 5-line resolver per package to avoid a fake shared
"utils" dependency).

**Exit criteria:**
- Env var unset → identical behavior (existing tests pass untouched).
- Env var set to a temp fixture dir → all five installers read from it
  (new unit tests, one per package, using `bundledRoot`/env override).

### S1 — Bundle script (`scripts/bundle-host.mjs`)

Per ADR 0017 Step 1–2:

- esbuild: entry `apps/cli/src/index.ts`, `platform=node`, `format=esm`,
  `target=node20`, out `dist-host/host-serve.mjs`, `metafile: true`.
- Externals (initial): `@earendil-works/pi-coding-agent`,
  `@silvia-odwyer/photon-node`. Grow the list empirically via S5 smoke.
- createRequire banner (ESM bundles lose `require`).
- Stage externals: `pnpm deploy --filter @piwin/cli --prod` → prune packages
  the metafile shows as inlined → `dist-host/node_modules`.
- Copy bundled assets (S0 layout) → `dist-host/bundled-assets/`.
- Verify step inside the script: assert existence of
  `node_modules/@earendil-works/pi-coding-agent/dist/index.js` and
  `photon_rs_bg.wasm`; fail loudly if missing.
- Root scripts: `"bundle:host": "node scripts/bundle-host.mjs"`;
  `package:desktop` prepends `pnpm bundle:host`.
- Add `dist-host/` to `.gitignore`.
- New devDependency: `esbuild` (root). Justification: ADR 0017.

**Exit criteria:** `pnpm bundle:host` succeeds from clean checkout; then
`node dist-host/host-serve.mjs host serve --mock` (with
`PIWIN_BUNDLED_ASSETS_ROOT=dist-host/bundled-assets`) emits a valid
`host/status` JSONL line. Scripted as `scripts/smoke-bundled-host.mjs`,
wired as `pnpm test:bundle` (not part of default `pnpm test`; needs the
bundle built first).

### S2 — Node runtime fetch per target triple

- `scripts/fetch-node-runtime.mjs`: download + unpack official Node LTS for
  the target triple, place at
  `apps/desktop/src-tauri/binaries/piwin-host-<triple>[.exe]`.
- Pin the exact Node version in the script (constant), verify SHA256 from
  `SHASUMS256.txt`.
- Cache downloads under `~/.cache/piwin-build/` to keep repeat packaging fast.
- `binaries/` goes in `.gitignore`.
- Default triple = host machine (`rustc -vV` / `process` detection);
  `--target <triple>` flag for cross-packaging later.

**Exit criteria:** script produces a runnable
`binaries/piwin-host-<triple> --version` for the current machine; checksum
verified; second run hits cache.

### S3 — Tauri wiring

`apps/desktop/src-tauri/tauri.conf.json`:

- `bundle.externalBin: ["binaries/piwin-host"]`
- `bundle.resources`: map `dist-host/host-serve.mjs`,
  `dist-host/node_modules`, `dist-host/bundled-assets` under `host/`.

**Exit criteria:** `pnpm package:desktop` produces an artifact whose bundle
contains the sidecar binary + `host/` resources (inspect the `.app`/bundle
tree manually and note paths in the PR).

### S4 — Rust `resolve_host_command` two-tier resolution

`apps/desktop/src-tauri/src/host_bridge.rs`:

- Tier 1 (packaged): if the resolved resource path
  `host/host-serve.mjs` and the sidecar binary exist →
  spawn `piwin-host host-serve.mjs host serve --mode sdk [--mock]`, with
  `PIWIN_BUNDLED_ASSETS_ROOT` env pointing at the resources `host/bundled-assets`.
- Tier 2 (dev): existing pnpm/tsx spawn, byte-for-byte unchanged.
- Use Tauri `PathResolver` for resource paths; no hardcoding.
- Emit chosen tier + resolved program path through the existing `host-log`
  event (diagnosability requirement from ADR 0017 Step 5).

**Exit criteria:**
- Dev run (`pnpm dev:tauri`) still uses tier 2; `host-log` says so.
- Rust unit test for the resolution decision (packaged paths present/absent),
  `cargo test` green.

### S5 — Clean-machine smoke (gate for ADR Accepted)

ADR 0017 Step 6 checklist, run on a user account **without** pnpm/tsx/checkout:

- install artifact → launch → `host/status` `ready: true, mock: false`
- open project → one real model turn (`run/phase` → `run/terminal completed`)
- paste image → lands in `~/.piwin/media/` (photon/WASM path)
- skills / extensions / themes / pets listings work (exercises S0 + Pi
  ResourceLoader)
- quit → `ShutdownDisposition::Graceful`

Record results as a dated note in `docs/notes/`. Any failure loops back to
S1 externals or S0 layout — expected iteration point.

### S6 — Docs closeout

- ADR 0017 → **Accepted**, link smoke note.
- `docs/release-desktop.md`: drop the internal-only caveat, document
  `bundle:host` in the packaging flow and Node-version pin.
- `docs/architecture.md` capability table: transport row loses
  "developer preview only" for packaged builds (keep honest wording for
  non-smoke-tested platforms).

## Risks

| Risk | Mitigation |
|------|------------|
| Pi transitive deps break when inlined (dynamic require, asset reads) | S1 metafile + `test:bundle` smoke catches early; move offender to externals list (expected, budgeted iteration) |
| `pnpm deploy` output misses a transitive dep of an external | S1 verify step asserts key files; `test:bundle` runs the real entry |
| jiti / dynamic loading inside Pi resolves against wrong root | Pi stays external with intact `node_modules` layout — its own relative reads keep working; smoke S5 confirms |
| Windows path/exe differences | S2/S4 keep triple + `.exe` handling explicit; Windows smoke can trail macOS without blocking ADR acceptance for macOS (state platform coverage honestly in S6) |
| Bundle drift when Pi version bumps later | ADR 0017 consequence: any Pi bump re-runs `test:bundle` + S5; note added to dependency-policy by S6 |

## Order & commit plan

```text
S0  (own commit(s); safe to land on main even before the rest)
S1 → S2  (parallel-safe after S0; separate commits)
S3 → S4  (depend on S1/S2 artifacts)
S5  (manual gate, produces evidence note)
S6  (docs flip)
```

Suggested first session in the worktree: S0 + S1, ending with a passing
`pnpm test:bundle`.

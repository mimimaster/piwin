# piwin

Private coding agent shell on top of [Pi Agent Harness](https://github.com/earendil-works/pi).

| Surface | Choice |
|---------|--------|
| Desktop | Tauri 2 |
| CLI | Shared agent host with desktop |
| Kernel | Pi (`SDK` + `RPC` dual mode) |
| Config root | `~/.piwin` (maps/overlays Pi resources) |
| Visibility | Private first |

> Status: local agent shell — see [product status](./docs/product-status.md) and run `pnpm dev:cli` → `piwin doctor`.

## Workspace layout

```text
apps/
  desktop/          # Tauri app (UI shell)
  cli/              # piwin CLI
packages/
  contracts/        # shared types & protocol (no UI)
  agent-host/       # session host + Pi SDK/RPC adapters
  session/          # history index, tree projection
  project/          # workspace / project layering
  skills/           # skill registry + defaults
  mcp/              # MCP config + client
  tools-web/        # web_search + web_fetch
  git/              # status / diff / commit graph
  theme/            # theme packages
  pet/              # Codex-compatible pets
  artifact/         # markdown + HTML artifact runtime
  media/            # image paste / preview / local paths
  marketplace/      # skill/mcp/theme/pet install sources
  ui-kit/           # shared desktop UI primitives
docs/
  prd.md
  architecture.md
  artifact-research.md
  adr/              # architecture decision records
skills/             # bundled agent skills
extensions/         # optional Pi extensions
```

## Principles

1. UI never talks to Pi internals directly — only through `agent-host`.
2. New capability = contracts first, then package, then app wiring.
3. Prefer adapters over forking Pi.
4. Desktop and CLI share one host and one config root.

## Docs

- [PRD](./docs/prd.md)
- [Architecture](./docs/architecture.md)
- [Artifact research](./docs/artifact-research.md)
- [ADRs](./docs/adr/)
- [Deferred TODO](./docs/todo-deferred.md)
- [Product status](./docs/product-status.md)
- [Product optimization program](./docs/specs/product-optimization-program.md)

## Local setup (later)

```bash
pnpm install
pnpm dev:cli
pnpm dev:desktop
pnpm e2e:smoke      # host IPC smoke (no UI)
pnpm e2e:desktop   # Desktop UI e2e (Vite + HostClient mock; once: pnpm --dir apps/desktop e2e:install)
pnpm automated-prerequisite-gate  # automated checks; not a release candidate
```

### Automated prerequisite sequence

All non-interactive checks run via `pnpm automated-prerequisite-gate`:

| Gate | Scope | Evidence type |
|------|-------|---------------|
| `pnpm check` | TypeScript + package unit tests | TS typecheck + vitest |
| `pnpm e2e:desktop` | Vite + in-browser HostClient mock renderer | Browser mock coverage |
| `pnpm e2e:host-jsonl` | Spawned `piwin host serve` JSONL sidecar | Live sidecar protocol |
| `cargo test` | Tauri Rust unit tests | Native Rust |
| `cargo check` | Tauri Rust compilation | Rust type-check |

A successful automated prerequisite run is **not** a release candidate. Before
declaring one, a separately reviewed, dated native macOS evidence manifest is
required (see [trace recipe](docs/plans/2026-07-24-responsiveness-trace-recipe.md)).
It must identify the revision, hardware/macOS version, transport mode, each E5
scenario outcome/timing, and sanitized trace, screenshot, and PID-cleanup
references.

### Evidence classification

| Layer | Coverage | Labels |
|-------|----------|--------|
| **Browser mock renderer** | Desktop UI under Vite + HostClient mock | Vite + in-browser mock renderer coverage |
| **Live JSONL sidecar** | Spawned `piwin host serve --mode sdk --mock` | Live JSONL sidecar coverage |
| **Native macOS / Tauri** | Real Tauri window, Instruments traces, PID cleanup | Native macOS evidence |
| **Developer-preview topology** | Workspace `pnpm`/`tsx` host from source checkout | Developer preview only — no bundled Node runtime |

### Deferred (explicitly not in release gate)

- **Packaged host distribution:** bundled executable/Node runtime, signing,
  clean-machine verification — separate plan needed.
- **True RPC worker isolation:** ADR 0012 design — product uses SDK fallback.
- **Follow-up turn lifecycle:** `session/follow_up` validates run ownership,
  but distinct foreground lifecycle design is deferred.

## Desktop (Tauri)

Prerequisites (macOS):

```bash
# Rust
source "$HOME/.cargo/env" 2>/dev/null || source /Volumes/BigDisk/DevCache/cargo/env
rustc -V && cargo -V

# Xcode tools
xcode-select -p
```

Run:

```bash
pnpm install
pnpm dev:desktop      # Vite UI only → http://localhost:1420
pnpm dev:tauri        # full native window (first run compiles Rust)
```

Architecture: React UI → `HostClient` (mock now) → later `piwin host serve` sidecar. Apps never import Pi.

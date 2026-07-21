# piwin

Private coding agent shell on top of [Pi Agent Harness](https://github.com/earendil-works/pi).

| Surface | Choice |
|---------|--------|
| Desktop | Tauri 2 |
| CLI | Shared agent host with desktop |
| Kernel | Pi (`SDK` + `RPC` dual mode) |
| Config root | `~/.piwin` (maps/overlays Pi resources) |
| Visibility | Private first |

> Status: scaffolding / design phase.

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

## Local setup (later)

```bash
pnpm install
pnpm dev:cli
pnpm dev:desktop
pnpm e2e:smoke      # host IPC smoke (no UI)
pnpm e2e:desktop   # Desktop UI e2e (Vite + HostClient mock; once: pnpm --dir apps/desktop e2e:install)
```

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


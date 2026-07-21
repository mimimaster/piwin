# @piwin/desktop

Tauri 2 + Vite + React Agent Window.

## Prerequisites

```bash
source "$HOME/.cargo/env" 2>/dev/null || source /Volumes/BigDisk/DevCache/cargo/env
rustc -V && cargo -V
xcode-select -p
pnpm -v
```

## Run (from monorepo root only)

```bash
cd ~/Projects/piwin   # MUST be repo root (has package.json + pnpm-workspace.yaml)
pnpm install

# Browser UI only (HostClient mock transport)
pnpm dev:desktop
# → http://localhost:1420

# Native window (live HostClient → host serve --mock)
pnpm dev:tauri
```

Do **not** run `pnpm dev:tauri` from `$HOME` or other directories.
Tauri `beforeDevCommand` is pinned to `apps/desktop` via `cwd: ".."`.

## Transport

| Runtime | HostClient transport | Agent |
|---------|----------------------|-------|
| Vite browser | in-process mock | mock events |
| Tauri window | Rust JSONL bridge | `host serve --mock` (default) |

Never import `@earendil-works/*` from desktop.

## UI e2e (Playwright, local)

Browser shell against in-process HostClient mock (no Tauri / no real Pi):

```bash
# from monorepo root
pnpm --dir apps/desktop e2e:install   # once: Chromium
pnpm e2e:desktop
```

Details: [e2e/README.md](./e2e/README.md).


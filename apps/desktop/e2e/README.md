# Desktop UI e2e (Playwright)

Local-first browser e2e for the Agent Window shell.

## What this covers

| Layer | Reality |
|-------|---------|
| UI | React Vite app (`pnpm dev:desktop`) |
| Host | In-browser `HostClient` **mock** transport |
| Not covered yet | Tauri native window + `host serve` sidecar (true live IPC) |

Scenarios (D-M2-05b local slice):

1. Shell loads, host ready, `tx:mock`
2. Settings open/close
3. Open project → trust → new session in list
4. Mock chat round-trip

## Run (from monorepo root)

```bash
# one-time browser binary
pnpm --dir apps/desktop e2e:install

# all desktop e2e
pnpm e2e:desktop

# headed / UI mode
pnpm --dir apps/desktop e2e:headed
pnpm --dir apps/desktop e2e:ui
```

Playwright starts Vite on port `1420` unless already running (`reuseExistingServer` outside CI).

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `PIWIN_E2E_PORT` | `1420` | Vite port |
| `PIWIN_E2E_BASE_URL` | `http://127.0.0.1:1420` | baseURL |

## Later

- Tauri WebDriver / `tauri-driver` for live host path
- Optional CI job (keep host `pnpm e2e:smoke` as primary gate until UI e2e is stable)
